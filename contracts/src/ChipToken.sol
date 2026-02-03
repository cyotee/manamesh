// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import { IChipToken } from "./interfaces/IChipToken.sol";

/**
 * @title ChipToken
 * @notice Universal chip token for ManaMesh games
 * @dev ERC-20 with ERC-2612 permit, backed 1:1 by ETH deposits
 *
 * Users deposit ETH to mint chips, which can be used across all games.
 * Chips are burned when withdrawing ETH.
 *
 * The permit functionality enables gasless deposits and escrow operations
 * when combined with the GameVault contract.
 */
contract ChipToken is ERC20, ERC20Permit, IChipToken {
    /// @notice Contract owner for admin functions
    address public immutable owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "ChipToken: not owner");
        _;
    }

    constructor() ERC20("ManaMesh Chips", "CHIP") ERC20Permit("ManaMesh Chips") {
        owner = msg.sender;
    }

    /**
     * @inheritdoc IChipToken
     */
    function deposit() external payable override {
        if (msg.value == 0) revert ZeroDeposit();

        _mint(msg.sender, msg.value);
        emit Deposited(msg.sender, msg.value, msg.value);
    }

    /**
     * @inheritdoc IChipToken
     */
    function withdraw(uint256 amount) external override {
        if (amount == 0) revert ZeroWithdraw();
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();

        // Burn chips first
        _burn(msg.sender, amount);

        // Return ETH 1:1
        (bool success,) = msg.sender.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, amount);
    }

    /**
     * @inheritdoc IChipToken
     */
    function ethReserve() external view override returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Allow contract to receive ETH directly (for future features)
     */
    receive() external payable {
        // Accept ETH transfers
    }
}
