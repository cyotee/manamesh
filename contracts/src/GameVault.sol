// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { IGameVault } from "./interfaces/IGameVault.sol";
import { IChipToken } from "./interfaces/IChipToken.sol";
import { SignatureVerifier } from "./libraries/SignatureVerifier.sol";

/**
 * @title GameVault
 * @notice Escrow and settlement vault for ManaMesh games
 * @dev Handles chip escrow, hand settlement, fold authorization, and abandonment
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

    /// @notice The chip token contract
    IChipToken public immutable chips;

    /// @notice Abandonment timeout in seconds (default: 10 minutes)
    uint256 public abandonmentTimeout = 600;

    /// @notice Dispute stake required (anti-griefing)
    uint256 public disputeStake = 0.01 ether;

    /// @notice Player escrow balances: gameId => player => amount
    mapping(bytes32 => mapping(address => uint256)) private _escrow;

    /// @notice Players in each game: gameId => players[]
    mapping(bytes32 => address[]) private _gamePlayers;

    /// @notice Track settled hands to prevent double-settlement
    mapping(bytes32 => mapping(bytes32 => bool)) private _settledHands;

    /// @notice Track fold authorizations: handId => foldingPlayer => authorized
    mapping(bytes32 => mapping(address => bool)) private _foldAuthorized;

    /// @notice Track allowed settler addresses for a fold: handId => foldingPlayer => settler => allowed
    mapping(bytes32 => mapping(address => mapping(address => bool))) private _foldAuthorizedSettle;

    /// @notice Contract owner
    address public immutable OWNER;

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    constructor(IChipToken _chips) EIP712("ManaMesh", "1") {
        chips = _chips;
        OWNER = msg.sender;
    }

    // =============================================================
    //                      ESCROW MANAGEMENT
    // =============================================================

    /// @inheritdoc IGameVault
    function joinGame(bytes32 gameId, uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        // Transfer chips to vault
        IERC20(address(chips)).safeTransferFrom(msg.sender, address(this), amount);

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
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external override {
        if (amount == 0) revert ZeroAmount();

        // Use permit for gasless approval
        IERC20Permit(address(chips)).permit(msg.sender, address(this), amount, deadline, v, r, s);

        // Transfer chips to vault
        IERC20(address(chips)).safeTransferFrom(msg.sender, address(this), amount);

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

        // Clear escrow
        _escrow[gameId][msg.sender] = 0;

        // Return chips
        IERC20(address(chips)).safeTransfer(msg.sender, balance);

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
        _processFolds(folds, foldSigs);

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
            address signer = SignatureVerifier.recoverSigner(_domainSeparatorV4(), structHash, signatures[i]);
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

        // Clear balance
        _escrow[gameId][msg.sender] = 0;

        // Transfer chips back
        IERC20(address(chips)).safeTransfer(msg.sender, balance);

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

        // Verify the bet chain
        address[] memory players = _gamePlayers[gameId];
        if (!SignatureVerifier.verifyBetChain(_domainSeparatorV4(), betChain, betSigs, players)) {
            revert InvalidBetChain();
        }

        // Determine actual winner from bet chain
        // This is a simplified implementation - real logic would analyze the bets
        address actualWinner = _determineWinnerFromBets(betChain, players);

        emit DisputeRaised(gameId, handId, msg.sender);
        emit DisputeResolved(gameId, handId, actualWinner, true);

        // Refund dispute stake to successful challenger
        (bool success,) = msg.sender.call{ value: msg.value }("");
        require(success, "Refund failed");
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

    function _settleHand(
        bytes32 gameId,
        HandResult calldata hand,
        bytes[] calldata signatures,
        address[] memory players
    ) internal {
        // Check not already settled
        if (_settledHands[gameId][hand.handId]) revert AlreadySettled();

        // Verify hand belongs to this game
        if (hand.gameId != gameId) revert GameNotActive();

        // Verify winner is a player in the game
        if (!_isPlayerInGame(gameId, hand.winner)) revert PlayerNotInGame();

        // Verify signatures from all active players (excluding folded)
        bytes32 structHash = SignatureVerifier.hashHandResult(hand);
        uint256 requiredSigs = 0;
        uint256 validSigs = 0;

        for (uint256 i = 0; i < players.length; i++) {
            // Skip if player folded this hand
            if (_foldAuthorized[hand.handId][players[i]]) {
                if (
                    msg.sender != players[i]
                        && !_foldAuthorizedSettle[hand.handId][players[i]][msg.sender]
                ) {
                    revert InvalidFoldAuth();
                }
                continue;
            }

            requiredSigs++;

            // Find matching signature
            for (uint256 j = 0; j < signatures.length; j++) {
                if (SignatureVerifier.verify(
                        _domainSeparatorV4(), structHash, signatures[j], players[i]
                    )) {
                    validSigs++;
                    break;
                }
            }
        }

        if (validSigs < requiredSigs) revert InsufficientSignatures();

        // Mark as settled
        _settledHands[gameId][hand.handId] = true;

        // Settlement must conserve escrow. Winner gains exactly what others lose.
        uint256 potPerLoser = hand.potAmount / (players.length - 1);
        uint256 remainder = hand.potAmount - (potPerLoser * (players.length - 1));
        uint256 credited = 0;

        for (uint256 i = 0; i < players.length; i++) {
            if (players[i] == hand.winner) continue;

            uint256 deduction = potPerLoser;
            if (remainder > 0) {
                deduction += 1;
                remainder -= 1;
            }

            if (_escrow[gameId][players[i]] < deduction) revert InsufficientEscrow();
            _escrow[gameId][players[i]] -= deduction;
            credited += deduction;
        }

        _escrow[gameId][hand.winner] += credited;

        emit HandSettled(gameId, hand.handId, hand.winner, hand.potAmount);
    }

    function _processFolds(FoldAuth[] calldata folds, bytes[] calldata foldSigs) internal {
        for (uint256 i = 0; i < folds.length; i++) {
            bytes32 structHash = SignatureVerifier.hashFoldAuth(folds[i]);

            // Verify fold is signed by the folding player
            if (!SignatureVerifier.verify(
                    _domainSeparatorV4(), structHash, foldSigs[i], folds[i].foldingPlayer
                )) {
                revert InvalidSignature();
            }

            // Record fold authorization
            _foldAuthorized[folds[i].handId][folds[i].foldingPlayer] = true;

            // Record allowed settlers
            for (uint256 j = 0; j < folds[i].authorizedSettlers.length; j++) {
                _foldAuthorizedSettle[folds[i].handId][folds[i].foldingPlayer][folds[i].authorizedSettlers[j]] =
                    true;
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

    function _determineWinnerFromBets(Bet[] calldata betChain, address[] memory players)
        internal
        pure
        returns (address)
    {
        // Simplified: return player who made last non-fold bet
        // Real implementation would analyze poker hand rankings
        for (uint256 i = betChain.length; i > 0; i--) {
            if (betChain[i - 1].action != 0) {
                // Not a fold
                return players[(i - 1) % players.length];
            }
        }
        return players[0];
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
