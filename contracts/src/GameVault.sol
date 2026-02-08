// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { IGameVault } from "./interfaces/IGameVault.sol";
import { IChipTokenFactory } from "./interfaces/IChipTokenFactory.sol";
import { SignatureVerifier } from "./libraries/SignatureVerifier.sol";

/**
 * @title GameVault
 * @notice Escrow and settlement vault for ManaMesh games
 * @dev Handles chip escrow, hand settlement, fold authorization, and abandonment.
 *      Supports multiple chip token types — each game uses a single chip token
 *      set by the first player to join.
 *
 * Settlement flow:
 * 1. Players join game → chips locked in escrow
 * 2. Play happens off-chain → bets signed with EIP-712
 * 3. Hand ends → all players sign HandResult
 * 4. Settlement → batch verify and update balances
 * 5. Withdraw → players reclaim their chips
 *
 * Edge cases:
 * - Fold: Player signs FoldAuth, others can settle without them
 * - Abandonment: After timeout, remaining players claim stake
 * - Dispute: Submit bet chain to prove fraud
 */
contract GameVault is IGameVault, EIP712 {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice The chip token factory
    IChipTokenFactory public immutable chipFactory;

    /// @notice Abandonment timeout in seconds (default: 10 minutes)
    uint256 public abandonmentTimeout = 600;

    /// @notice Dispute stake required (anti-griefing)
    uint256 public disputeStake = 0.01 ether;

    /// @notice Chip token used by each game: gameId => chipToken
    mapping(bytes32 => address) public gameChipToken;

    /// @notice Player escrow balances: gameId => player => amount
    mapping(bytes32 => mapping(address => uint256)) private _escrow;

    /// @notice Players in each game: gameId => players[]
    mapping(bytes32 => address[]) private _gamePlayers;

    /// @notice Track settled hands to prevent double-settlement
    mapping(bytes32 => mapping(bytes32 => bool)) private _settledHands;

    /// @notice Track disputed hands to prevent double-dispute
    mapping(bytes32 => mapping(bytes32 => bool)) private _disputedHands;

    /// @notice Store settled deltas for dispute reversal: gameId => handId => player => delta
    mapping(bytes32 => mapping(bytes32 => mapping(address => int256))) private _settledDeltas;

    /// @notice Store settled hand players for dispute reversal: gameId => handId => players
    mapping(bytes32 => mapping(bytes32 => address[])) private _settledPlayers;

    /// @notice Track fold authorizations: handId => foldingPlayer => authorized
    mapping(bytes32 => mapping(address => bool)) private _foldAuthorized;

    /// @notice Track allowed settler addresses for a fold: handId => foldingPlayer => settler => allowed
    mapping(bytes32 => mapping(address => mapping(address => bool))) private _foldAuthorizedSettle;

    /// @notice Contract owner
    address public immutable OWNER;

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    constructor(IChipTokenFactory _chipFactory) EIP712("ManaMesh", "1") {
        chipFactory = _chipFactory;
        OWNER = msg.sender;
    }

    // =============================================================
    //                      ESCROW MANAGEMENT
    // =============================================================

    /// @inheritdoc IGameVault
    function joinGame(bytes32 gameId, address chipToken, uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();
        _validateAndSetChipToken(gameId, chipToken);

        // Transfer chips to vault
        IERC20(chipToken).safeTransferFrom(msg.sender, address(this), amount);

        // Update escrow
        _escrow[gameId][msg.sender] += amount;

        // Track player if new
        if (!_isPlayerInGame(gameId, msg.sender)) {
            _gamePlayers[gameId].push(msg.sender);
        }

        emit PlayerJoined(gameId, msg.sender, amount);
    }

    /// @inheritdoc IGameVault
    function joinGameWithPermit(
        bytes32 gameId,
        address chipToken,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        if (amount == 0) revert ZeroAmount();
        _validateAndSetChipToken(gameId, chipToken);

        // Use permit for gasless approval
        IERC20Permit(chipToken).permit(msg.sender, address(this), amount, deadline, v, r, s);

        // Transfer chips to vault
        IERC20(chipToken).safeTransferFrom(msg.sender, address(this), amount);

        // Update escrow
        _escrow[gameId][msg.sender] += amount;

        // Track player if new
        if (!_isPlayerInGame(gameId, msg.sender)) {
            _gamePlayers[gameId].push(msg.sender);
        }

        emit PlayerJoined(gameId, msg.sender, amount);
    }

    /// @inheritdoc IGameVault
    function leaveGame(bytes32 gameId) external override {
        uint256 balance = _escrow[gameId][msg.sender];
        if (balance == 0) revert NothingToWithdraw();

        address chipToken = gameChipToken[gameId];

        // Clear escrow
        _escrow[gameId][msg.sender] = 0;

        // Return chips
        IERC20(chipToken).safeTransfer(msg.sender, balance);

        emit PlayerLeft(gameId, msg.sender, balance);
    }

    // =============================================================
    //                         SETTLEMENT
    // =============================================================

    /// @inheritdoc IGameVault
    function settleHands(
        bytes32 gameId,
        HandResult[] calldata hands,
        bytes[][] calldata signatures,
        FoldAuth[] calldata folds,
        bytes[] calldata foldSigs
    ) external override {
        if (hands.length != signatures.length) {
            revert InsufficientSignatures();
        }

        if (folds.length != foldSigs.length) {
            revert InvalidFoldAuth();
        }

        // Process fold authorizations first
        _processFolds(gameId, folds, foldSigs);

        // Get players for signature verification
        address[] memory players = _gamePlayers[gameId];

        if (players.length < 2) revert GameNotActive();

        // Process each hand
        for (uint256 i = 0; i < hands.length; i++) {
            _settleHand(gameId, hands[i], signatures[i], players);
        }
    }

    /// @inheritdoc IGameVault
    function claimAbandonment(
        bytes32 gameId,
        Abandonment calldata claim,
        bytes[] calldata signatures
    ) external override {
        if (claim.gameId != gameId) revert GameNotActive();

        // Verify timeout has passed
        if (block.timestamp < claim.abandonedAt + abandonmentTimeout) {
            revert TimeoutNotReached();
        }

        // Verify abandoned player is in the game
        if (_escrow[gameId][claim.abandonedPlayer] == 0) {
            revert PlayerNotInGame();
        }

        if (claim.splitRecipients.length != claim.splitAmounts.length) revert InvalidSplit();

        // Verify all remaining players signed
        bytes32 structHash = SignatureVerifier.hashAbandonment(claim);
        address[] memory remainingPlayers = _getRemainingPlayers(gameId, claim.abandonedPlayer);

        if (signatures.length != remainingPlayers.length) {
            revert InsufficientSignatures();
        }

        // Signatures can be provided in any order; each remaining player must appear once
        bool[] memory seen = new bool[](remainingPlayers.length);
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer =
                SignatureVerifier.recoverSigner(_domainSeparatorV4(), structHash, signatures[i]);
            bool matched = false;
            for (uint256 j = 0; j < remainingPlayers.length; j++) {
                if (signer == remainingPlayers[j]) {
                    if (seen[j]) revert InvalidSignature();
                    seen[j] = true;
                    matched = true;
                    break;
                }
            }
            if (!matched) revert InvalidSignature();
        }

        // Get abandoned player's escrow
        uint256 abandonedAmount = _escrow[gameId][claim.abandonedPlayer];
        _escrow[gameId][claim.abandonedPlayer] = 0;

        uint256 splitTotal = 0;
        for (uint256 i = 0; i < claim.splitAmounts.length; i++) {
            splitTotal += claim.splitAmounts[i];
        }
        if (splitTotal != abandonedAmount) revert InvalidSplit();

        for (uint256 i = 0; i < claim.splitRecipients.length; i++) {
            if (!_isPlayerInGame(gameId, claim.splitRecipients[i])) revert InvalidSplit();
            if (claim.splitRecipients[i] == claim.abandonedPlayer) revert InvalidSplit();
        }

        // Distribute according to claim
        for (uint256 i = 0; i < claim.splitRecipients.length; i++) {
            _escrow[gameId][claim.splitRecipients[i]] += claim.splitAmounts[i];
        }

        emit PlayerAbandoned(gameId, claim.abandonedPlayer, abandonedAmount);
        emit EscrowDistributed(gameId, claim.splitRecipients, claim.splitAmounts);
    }

    /// @inheritdoc IGameVault
    function withdraw(bytes32 gameId) external override {
        uint256 balance = _escrow[gameId][msg.sender];
        if (balance == 0) revert NothingToWithdraw();

        address chipToken = gameChipToken[gameId];

        // Clear balance
        _escrow[gameId][msg.sender] = 0;

        // Transfer chips back
        IERC20(chipToken).safeTransfer(msg.sender, balance);

        emit Withdrawn(gameId, msg.sender, balance);
    }

    // =============================================================
    //                          DISPUTES
    // =============================================================

    /// @inheritdoc IGameVault
    function disputeHand(
        bytes32 gameId,
        bytes32 handId,
        Bet[] calldata betChain,
        bytes[] calldata betSigs
    ) external payable override {
        // Require dispute stake
        if (msg.value < disputeStake) revert DisputeStakeRequired();

        // Hand must have been settled
        if (!_settledHands[gameId][handId]) revert HandNotSettled();

        // Prevent double dispute
        if (_disputedHands[gameId][handId]) revert AlreadyDisputed();

        // Verify the bet chain (each bet signed by its declared bettor)
        if (!SignatureVerifier.verifyBetChain(_domainSeparatorV4(), betChain, betSigs)) {
            revert InvalidBetChain();
        }

        // Verify all bets belong to this hand and all bettors are game players
        for (uint256 i = 0; i < betChain.length; i++) {
            if (betChain[i].handId != handId) revert InvalidBetChain();
            if (!_isPlayerInGame(gameId, betChain[i].bettor)) revert InvalidBetChain();
        }

        // Replay bet chain to compute actual contributions per player
        (address[] memory bettors, uint256[] memory contributions, bool[] memory folded) =
            _replayBetChain(betChain);

        // Verify settlement matches bet chain constraints
        bool fraudDetected =
            _detectFraud(gameId, handId, bettors, contributions, folded);

        emit DisputeRaised(gameId, handId, msg.sender);

        if (fraudDetected) {
            // Mark as disputed
            _disputedHands[gameId][handId] = true;

            // Determine most egregious beneficiary of fraud (before reversal)
            address fraudBeneficiary = _findFraudBeneficiary(gameId, handId);

            // Reverse the settlement
            _reverseSettlement(gameId, handId);

            // Re-settle: folded players lose contributions, non-folded get
            // their contributions returned (conservative approach since we
            // can't determine the hand winner on-chain)
            _applyDisputeSettlement(gameId, handId, bettors, contributions, folded);

            emit DisputeResolved(gameId, handId, fraudBeneficiary, true);

            // Refund dispute stake to successful challenger
            (bool success,) = msg.sender.call{ value: msg.value }("");
            if (!success) revert DisputeFailed();
        } else {
            emit DisputeResolved(gameId, handId, address(0), false);

            // No fraud: challenger loses stake (kept by contract)
        }
    }

    // =============================================================
    //                            VIEWS
    // =============================================================

    /// @inheritdoc IGameVault
    function getEscrow(bytes32 gameId, address player) external view override returns (uint256) {
        return _escrow[gameId][player];
    }

    /**
     * @notice Get players in a game
     * @param gameId The game identifier
     * @return Array of player addresses
     */
    function getPlayers(bytes32 gameId) external view returns (address[] memory) {
        return _gamePlayers[gameId];
    }

    /**
     * @notice Check if a hand has been settled
     * @param gameId The game identifier
     * @param handId The hand identifier
     * @return True if hand is settled
     */
    function isHandSettled(bytes32 gameId, bytes32 handId) external view returns (bool) {
        return _settledHands[gameId][handId];
    }

    /**
     * @notice Get the EIP-712 domain separator
     * @return The domain separator
     */
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // =============================================================
    //                      INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @dev Validate chip token is from factory and set/check per-game token
     */
    function _validateAndSetChipToken(bytes32 gameId, address chipToken) internal {
        if (!chipFactory.isChipToken(chipToken)) revert InvalidChipToken();

        if (gameChipToken[gameId] == address(0)) {
            gameChipToken[gameId] = chipToken;
        } else if (gameChipToken[gameId] != chipToken) {
            revert ChipTokenMismatch();
        }
    }

    function _settleHand(
        bytes32 gameId,
        HandResult calldata hand,
        bytes[] calldata signatures,
        address[] memory gamePlayers
    ) internal {
        // Check not already settled
        if (_settledHands[gameId][hand.handId]) revert AlreadySettled();

        // Verify hand belongs to this game
        if (hand.gameId != gameId) revert GameNotActive();

        // Validate per-player deltas
        if (hand.players.length != hand.deltas.length) revert PlayersAndDeltasLengthMismatch();
        if (hand.players.length == 0) revert GameNotActive();

        // Verify deltas sum to zero (conservation)
        int256 deltaSum = 0;
        for (uint256 i = 0; i < hand.deltas.length; i++) {
            deltaSum += hand.deltas[i];
        }
        if (deltaSum != 0) revert DeltasNotBalanced();

        // Verify all hand players are in the game
        for (uint256 i = 0; i < hand.players.length; i++) {
            if (!_isPlayerInGame(gameId, hand.players[i])) revert PlayerNotInGame();
        }

        // Verify signatures from all active players (excluding folded)
        bytes32 structHash = SignatureVerifier.hashHandResult(hand);
        uint256 requiredSigs = 0;
        uint256 validSigs = 0;

        for (uint256 i = 0; i < gamePlayers.length; i++) {
            // Skip if player folded this hand
            if (_foldAuthorized[hand.handId][gamePlayers[i]]) {
                // Verify settler is authorized by the folding player
                if (
                    msg.sender != gamePlayers[i]
                        && !_foldAuthorizedSettle[hand.handId][gamePlayers[i]][msg.sender]
                ) {
                    revert InvalidFoldAuth();
                }
                continue;
            }

            requiredSigs++;

            // Find matching signature
            for (uint256 j = 0; j < signatures.length; j++) {
                if (
                    SignatureVerifier.verify(
                        _domainSeparatorV4(), structHash, signatures[j], gamePlayers[i]
                    )
                ) {
                    validSigs++;
                    break;
                }
            }
        }

        if (validSigs < requiredSigs) revert InsufficientSignatures();

        // Mark as settled
        _settledHands[gameId][hand.handId] = true;

        // Store settlement data for potential dispute reversal
        _settledPlayers[gameId][hand.handId] = hand.players;
        for (uint256 i = 0; i < hand.players.length; i++) {
            _settledDeltas[gameId][hand.handId][hand.players[i]] = hand.deltas[i];
        }

        // Apply per-player deltas to escrow
        for (uint256 i = 0; i < hand.players.length; i++) {
            if (hand.deltas[i] < 0) {
                // Player is losing: deduct from escrow
                uint256 loss = uint256(-hand.deltas[i]);
                if (_escrow[gameId][hand.players[i]] < loss) revert InsufficientEscrow();
                _escrow[gameId][hand.players[i]] -= loss;
            } else if (hand.deltas[i] > 0) {
                // Player is winning: add to escrow
                _escrow[gameId][hand.players[i]] += uint256(hand.deltas[i]);
            }
        }

        emit HandSettled(gameId, hand.handId);
    }

    function _processFolds(bytes32 gameId, FoldAuth[] calldata folds, bytes[] calldata foldSigs)
        internal
    {
        for (uint256 i = 0; i < folds.length; i++) {
            // Verify fold is bound to this game
            if (folds[i].gameId != gameId) revert InvalidFoldAuth();

            // Verify folding player is in the game
            if (!_isPlayerInGame(gameId, folds[i].foldingPlayer)) revert InvalidFoldAuth();

            // Prevent duplicate fold processing
            if (_foldAuthorized[folds[i].handId][folds[i].foldingPlayer]) {
                revert InvalidFoldAuth();
            }

            bytes32 structHash = SignatureVerifier.hashFoldAuth(folds[i]);

            // Verify fold is signed by the folding player
            if (
                !SignatureVerifier.verify(
                    _domainSeparatorV4(), structHash, foldSigs[i], folds[i].foldingPlayer
                )
            ) {
                revert InvalidSignature();
            }

            // Record fold authorization
            _foldAuthorized[folds[i].handId][folds[i].foldingPlayer] = true;

            // Record allowed settlers
            for (uint256 j = 0; j < folds[i].authorizedSettlers.length; j++) {
                _foldAuthorizedSettle[folds[i].handId][folds[i].foldingPlayer][folds[i]
                    .authorizedSettlers[j]] = true;
            }
        }
    }

    function _isPlayerInGame(bytes32 gameId, address player) internal view returns (bool) {
        address[] memory players = _gamePlayers[gameId];
        for (uint256 i = 0; i < players.length; i++) {
            if (players[i] == player) return true;
        }
        return false;
    }

    function _getRemainingPlayers(bytes32 gameId, address excluded)
        internal
        view
        returns (address[] memory)
    {
        address[] memory allPlayers = _gamePlayers[gameId];
        address[] memory remaining = new address[](allPlayers.length - 1);

        uint256 j = 0;
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (allPlayers[i] != excluded) {
                remaining[j++] = allPlayers[i];
            }
        }
        return remaining;
    }

    /**
     * @dev Replay bet chain to extract per-player contributions and fold status
     */
    function _replayBetChain(Bet[] calldata betChain)
        internal
        pure
        returns (address[] memory bettors, uint256[] memory contributions, bool[] memory folded)
    {
        // Collect unique bettors
        address[] memory tempBettors = new address[](betChain.length);
        uint256 uniqueCount = 0;

        for (uint256 i = 0; i < betChain.length; i++) {
            bool found = false;
            for (uint256 j = 0; j < uniqueCount; j++) {
                if (tempBettors[j] == betChain[i].bettor) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                tempBettors[uniqueCount] = betChain[i].bettor;
                uniqueCount++;
            }
        }

        bettors = new address[](uniqueCount);
        contributions = new uint256[](uniqueCount);
        folded = new bool[](uniqueCount);

        for (uint256 i = 0; i < uniqueCount; i++) {
            bettors[i] = tempBettors[i];
        }

        // Replay: sum contributions and track folds
        for (uint256 i = 0; i < betChain.length; i++) {
            uint256 bettorIdx = _findBettorIndex(bettors, betChain[i].bettor);

            if (betChain[i].action == 0) {
                // Fold action
                folded[bettorIdx] = true;
            } else {
                // check(1), call(2), raise(3), all-in(4): add to contributions
                contributions[bettorIdx] += betChain[i].amount;
            }
        }
    }

    /**
     * @dev Detect fraud by comparing bet chain constraints against settled deltas
     *      Fraud is detected if:
     *      1. A folded player has a positive delta (winners can't fold)
     *      2. A non-folded player's delta is more negative than their contribution
     *      3. The final bet chain hash doesn't match the settled HandResult's finalBetHash
     */
    function _detectFraud(
        bytes32 gameId,
        bytes32 handId,
        address[] memory bettors,
        uint256[] memory contributions,
        bool[] memory folded
    ) internal view returns (bool) {
        for (uint256 i = 0; i < bettors.length; i++) {
            int256 settledDelta = _settledDeltas[gameId][handId][bettors[i]];

            // Fraud: folded player should not win (delta must be <= 0)
            if (folded[i] && settledDelta > 0) return true;

            // Fraud: player can't lose more than they contributed
            if (settledDelta < 0 && uint256(-settledDelta) > contributions[i]) {
                return true;
            }
        }

        return false;
    }

    /**
     * @dev Reverse a settled hand's deltas on the escrow
     */
    function _reverseSettlement(bytes32 gameId, bytes32 handId) internal {
        address[] memory players = _settledPlayers[gameId][handId];
        for (uint256 i = 0; i < players.length; i++) {
            int256 delta = _settledDeltas[gameId][handId][players[i]];
            if (delta > 0) {
                // Was a winner: deduct from escrow
                _escrow[gameId][players[i]] -= uint256(delta);
            } else if (delta < 0) {
                // Was a loser: restore to escrow
                _escrow[gameId][players[i]] += uint256(-delta);
            }
        }
    }

    /**
     * @dev Apply dispute resolution: folded players lose their contributions,
     *      pot is split equally among non-folded players
     */
    function _applyDisputeSettlement(
        bytes32 gameId,
        bytes32 handId,
        address[] memory bettors,
        uint256[] memory contributions,
        bool[] memory folded
    ) internal {
        // Calculate pot from folded player contributions
        uint256 foldedPot = 0;
        uint256 nonFoldedCount = 0;

        for (uint256 i = 0; i < bettors.length; i++) {
            if (folded[i]) {
                // Folded player loses their contribution
                _escrow[gameId][bettors[i]] -= contributions[i];
                foldedPot += contributions[i];
            } else {
                nonFoldedCount++;
            }
        }

        // Split folded pot equally among non-folded players
        if (nonFoldedCount > 0 && foldedPot > 0) {
            uint256 share = foldedPot / nonFoldedCount;
            uint256 remainder = foldedPot - (share * nonFoldedCount);

            bool firstNonFolded = true;
            for (uint256 i = 0; i < bettors.length; i++) {
                if (!folded[i]) {
                    uint256 bonus = share;
                    // Give remainder to first non-folded player
                    if (firstNonFolded && remainder > 0) {
                        bonus += remainder;
                        firstNonFolded = false;
                    }
                    _escrow[gameId][bettors[i]] += bonus;
                }
            }
        }

        // Update stored deltas to reflect dispute resolution
        for (uint256 i = 0; i < bettors.length; i++) {
            _settledDeltas[gameId][handId][bettors[i]] = 0;
        }
    }

    /**
     * @dev Find the player who benefited most from fraudulent settlement
     */
    function _findFraudBeneficiary(bytes32 gameId, bytes32 handId)
        internal
        view
        returns (address)
    {
        address[] memory players = _settledPlayers[gameId][handId];
        address beneficiary = players[0];
        int256 maxDelta = _settledDeltas[gameId][handId][players[0]];

        for (uint256 i = 1; i < players.length; i++) {
            int256 delta = _settledDeltas[gameId][handId][players[i]];
            if (delta > maxDelta) {
                maxDelta = delta;
                beneficiary = players[i];
            }
        }

        return beneficiary;
    }

    function _findBettorIndex(address[] memory bettors, address bettor)
        internal
        pure
        returns (uint256)
    {
        for (uint256 i = 0; i < bettors.length; i++) {
            if (bettors[i] == bettor) return i;
        }
        revert InvalidBetChain();
    }

    // =============================================================
    //                           ADMIN
    // =============================================================

    modifier onlyOwner() {
        require(msg.sender == OWNER, "GameVault: not owner");
        _;
    }

    function setAbandonmentTimeout(uint256 timeout) external onlyOwner {
        abandonmentTimeout = timeout;
    }

    function setDisputeStake(uint256 stake) external onlyOwner {
        disputeStake = stake;
    }

    receive() external payable { }
}
