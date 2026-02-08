// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IChipTokenFactory
 * @notice Interface for per-asset chip token factory
 * @dev Deploys one ERC-20 chip token per underlying asset.
 *      Each chip token is 1:1 backed by its underlying.
 */
interface IChipTokenFactory {
    // =============================================================
    //                            EVENTS
    // =============================================================

    event ChipTokenDeployed(address indexed underlying, address indexed chipToken);
    event Deposited(address indexed underlying, address indexed depositor, uint256 amount);
    event Withdrawn(address indexed underlying, address indexed withdrawer, uint256 amount);

    // =============================================================
    //                            ERRORS
    // =============================================================

    error ZeroAmount();
    error NoChipToken();
    error TransferFailed();
    error InvalidChipToken();

    // =============================================================
    //                      DEPOSIT / WITHDRAW
    // =============================================================

    /**
     * @notice Deposit ERC-20 tokens to receive chip tokens 1:1
     * @param underlying The ERC-20 token to deposit
     * @param amount The amount to deposit
     * @dev Deploys a new chip token on first deposit of a given underlying
     */
    function deposit(address underlying, uint256 amount) external;

    /**
     * @notice Deposit ETH to receive chip tokens 1:1
     * @dev Deploys a new chip token for ETH on first deposit
     */
    function depositETH() external payable;

    /**
     * @notice Withdraw underlying ERC-20 by burning chip tokens
     * @param underlying The underlying token to withdraw
     * @param amount The amount of chip tokens to burn
     */
    function withdraw(address underlying, uint256 amount) external;

    /**
     * @notice Withdraw ETH by burning chip tokens
     * @param amount The amount of chip tokens to burn
     */
    function withdrawETH(uint256 amount) external;

    // =============================================================
    //                            VIEWS
    // =============================================================

    /**
     * @notice Get the chip token for an underlying asset
     * @param underlying The underlying token (address(0) for ETH)
     * @return The chip token address, or address(0) if not deployed
     */
    function getChipToken(address underlying) external view returns (address);

    /**
     * @notice Check if an address is a factory-deployed chip token
     * @param token The address to check
     * @return True if the token was deployed by this factory
     */
    function isChipToken(address token) external view returns (bool);
}
