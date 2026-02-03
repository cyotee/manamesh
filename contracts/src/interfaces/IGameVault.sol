// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IChipToken } from "./IChipToken.sol";

/**
 * @title IGameVault
 * @notice Interface for the ManaMesh game escrow and settlement vault
 */
interface IGameVault {
    // =============================================================
    //                            STRUCTS
    // =============================================================

    /// @notice A signed hand result representing the outcome of one hand
    struct HandResult {
        bytes32 gameId;
        bytes32 handId;
        address winner;
        uint256 potAmount;
        bytes32 finalBetHash;
    }

    /// @notice Authorization for settlement without folded player
    struct FoldAuth {
        bytes32 handId;
        address foldingPlayer;
        address[] authorizedSettlers;
    }

    /// @notice Claim for abandoned player's stake
    struct Abandonment {
        bytes32 gameId;
        bytes32 handId;
        address abandonedPlayer;
        uint256 abandonedAt;
        address[] splitRecipients;
        uint256[] splitAmounts;
    }

    /// @notice A bet in a hand (used for disputes)
    struct Bet {
        bytes32 handId;
        uint256 betIndex;
        uint8 action; // 0=fold, 1=check, 2=call, 3=raise, 4=all-in
        uint256 amount;
        bytes32 previousBetHash;
    }

    // =============================================================
    //                            EVENTS
    // =============================================================

    event PlayerJoined(bytes32 indexed gameId, address indexed player, uint256 amount);
    event PlayerLeft(bytes32 indexed gameId, address indexed player, uint256 amount);
    event HandSettled(
        bytes32 indexed gameId, bytes32 indexed handId, address indexed winner, uint256 potAmount
    );
    event PlayerAbandoned(bytes32 indexed gameId, address indexed player, uint256 forfeited);
    event EscrowDistributed(bytes32 indexed gameId, address[] recipients, uint256[] amounts);
    event DisputeRaised(bytes32 indexed gameId, bytes32 indexed handId, address indexed challenger);
    event DisputeResolved(
        bytes32 indexed gameId, bytes32 indexed handId, address winner, bool fraudDetected
    );
    event Withdrawn(bytes32 indexed gameId, address indexed player, uint256 amount);

    // =============================================================
    //                            ERRORS
    // =============================================================

    error ZeroAmount();
    error InsufficientEscrow();
    error GameNotActive();
    error PlayerNotInGame();
    error InvalidSignature();
    error InsufficientSignatures();
    error InvalidFoldAuth();
    error InvalidSplit();
    error TimeoutNotReached();
    error InvalidBetChain();
    error DisputeStakeRequired();
    error AlreadySettled();
    error NothingToWithdraw();

    // =============================================================
    //                      ESCROW MANAGEMENT
    // =============================================================

    /**
     * @notice Join a game by locking chips in escrow
     * @param gameId The game identifier
     * @param amount The amount of chips to escrow
     */
    function joinGame(bytes32 gameId, uint256 amount) external;

    /**
     * @notice Join a game using ERC-2612 permit (gasless for user)
     * @param gameId The game identifier
     * @param amount The amount of chips to escrow
     * @param deadline Permit deadline
     * @param v Signature v
     * @param r Signature r
     * @param s Signature s
     */
    function joinGameWithPermit(
        bytes32 gameId,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @notice Leave a game and reclaim escrowed chips
     * @param gameId The game identifier
     * @dev Only works if game hasn't started or player is eliminated
     */
    function leaveGame(bytes32 gameId) external;

    // =============================================================
    //                         SETTLEMENT
    // =============================================================

    /**
     * @notice Settle multiple hands in a batch
     * @param gameId The game identifier
     * @param hands Array of hand results to settle
     * @param signatures Array of signature arrays (one per hand, from all players)
     * @param folds Array of fold authorizations (can be empty)
     * @param foldSigs Array of fold authorization signatures
     */
    function settleHands(
        bytes32 gameId,
        HandResult[] calldata hands,
        bytes[][] calldata signatures,
        FoldAuth[] calldata folds,
        bytes[] calldata foldSigs
    ) external;

    /**
     * @notice Claim an abandoned player's stake after timeout
     * @param gameId The game identifier
     * @param claim The abandonment claim
     * @param signatures Signatures from all remaining players
     */
    function claimAbandonment(
        bytes32 gameId,
        Abandonment calldata claim,
        bytes[] calldata signatures
    ) external;

    /**
     * @notice Withdraw settled chips from a game
     * @param gameId The game identifier
     */
    function withdraw(bytes32 gameId) external;

    // =============================================================
    //                          DISPUTES
    // =============================================================

    /**
     * @notice Dispute a hand result by submitting the bet chain
     * @param gameId The game identifier
     * @param handId The hand being disputed
     * @param betChain The full chain of bets for the hand
     * @param betSigs Signatures for each bet
     * @dev Requires disputeStake to be sent with the call
     */
    function disputeHand(
        bytes32 gameId,
        bytes32 handId,
        Bet[] calldata betChain,
        bytes[] calldata betSigs
    ) external payable;

    // =============================================================
    //                            VIEWS
    // =============================================================

    /**
     * @notice Get a player's escrowed balance for a game
     * @param gameId The game identifier
     * @param player The player address
     * @return The escrowed balance
     */
    function getEscrow(bytes32 gameId, address player) external view returns (uint256);

    /**
     * @notice Get the chip token address
     * @return The ChipToken contract address
     */
    function chips() external view returns (IChipToken);

    /**
     * @notice Get the abandonment timeout in seconds
     * @return The timeout duration
     */
    function abandonmentTimeout() external view returns (uint256);
}
