// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title IChipToken
 * @notice Interface for the ManaMesh chip token used across all games
 * @dev Extends ERC20 with deposit/withdraw functionality
 *      The implementation also supports ERC-2612 permit
 */
interface IChipToken is IERC20 {
    // Events
    event Deposited(address indexed depositor, uint256 ethAmount, uint256 chipsMinted);
    event Withdrawn(address indexed withdrawer, uint256 chipsAmount, uint256 ethReturned);

    // Errors
    error ZeroDeposit();
    error ZeroWithdraw();
    error InsufficientBalance();
    error TransferFailed();

    /**
     * @notice Deposit ETH to receive chip tokens at 1:1 rate
     * @dev Mints chips equal to msg.value
     */
    function deposit() external payable;

    /**
     * @notice Withdraw chips to receive ETH back
     * @param amount The amount of chips to burn
     * @dev Burns chips and returns proportional ETH
     */
    function withdraw(uint256 amount) external;

    /**
     * @notice Get the ETH balance backing the chip tokens
     * @return The ETH balance held by the contract
     */
    function ethReserve() external view returns (uint256);
}
