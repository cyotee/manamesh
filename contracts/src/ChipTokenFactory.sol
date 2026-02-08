// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20MintBurn } from "@crane/contracts/interfaces/IERC20MintBurn.sol";
import {
    IERC20PermitMintBurnLockedOwnableDFPkg
} from "@crane/contracts/tokens/ERC20/ERC20PermitMintBurnLockedOwnableDFPkg.sol";
import { IChipTokenFactory } from "./interfaces/IChipTokenFactory.sol";

/**
 * @title ChipTokenFactory
 * @notice Deploys per-asset chip tokens using Crane's ERC20 DFPkg
 * @dev Each underlying asset (ERC-20 or ETH) gets its own chip token.
 *      The factory is the owner of all deployed chip tokens and handles
 *      minting on deposit and burning on withdrawal.
 *
 *      Uses Crane's ERC20PermitMintBurnLockedOwnableDFPkg to create Diamond
 *      proxy tokens with ERC-20 + ERC-2612 Permit + owner-controlled MintBurn.
 */
contract ChipTokenFactory is IChipTokenFactory {
    using SafeERC20 for IERC20;

    // =============================================================
    //                           STORAGE
    // =============================================================

    /// @notice The Crane DFPkg used to deploy chip tokens
    IERC20PermitMintBurnLockedOwnableDFPkg public immutable TOKEN_PKG;

    /// @notice Underlying asset => chip token address
    mapping(address => address) private _chipTokens;

    /// @notice Chip token => whether it was deployed by this factory
    mapping(address => bool) private _validChipTokens;

    // =============================================================
    //                         CONSTRUCTOR
    // =============================================================

    constructor(IERC20PermitMintBurnLockedOwnableDFPkg pkg) {
        TOKEN_PKG = pkg;
    }

    // =============================================================
    //                      DEPOSIT / WITHDRAW
    // =============================================================

    /// @inheritdoc IChipTokenFactory
    function deposit(address underlying, uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        address chipToken = _getOrDeploy(underlying);

        // Transfer underlying from depositor to factory
        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);

        // Mint chip tokens to depositor (factory is owner, can mint)
        IERC20MintBurn(chipToken).mint(msg.sender, amount);

        emit Deposited(underlying, msg.sender, amount);
    }

    /// @inheritdoc IChipTokenFactory
    function depositETH() external payable override {
        if (msg.value == 0) revert ZeroAmount();

        address chipToken = _getOrDeploy(address(0));

        // Mint chip tokens to depositor
        IERC20MintBurn(chipToken).mint(msg.sender, msg.value);

        emit Deposited(address(0), msg.sender, msg.value);
    }

    /// @inheritdoc IChipTokenFactory
    function withdraw(address underlying, uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        address chipToken = _chipTokens[underlying];
        if (chipToken == address(0)) revert NoChipToken();

        // Burn chip tokens from withdrawer (factory is owner, can burn)
        IERC20MintBurn(chipToken).burn(msg.sender, amount);

        // Return underlying to withdrawer
        IERC20(underlying).safeTransfer(msg.sender, amount);

        emit Withdrawn(underlying, msg.sender, amount);
    }

    /// @inheritdoc IChipTokenFactory
    function withdrawETH(uint256 amount) external override {
        if (amount == 0) revert ZeroAmount();

        address chipToken = _chipTokens[address(0)];
        if (chipToken == address(0)) revert NoChipToken();

        // Burn chip tokens from withdrawer
        IERC20MintBurn(chipToken).burn(msg.sender, amount);

        // Return ETH
        (bool success,) = msg.sender.call{ value: amount }("");
        if (!success) revert TransferFailed();

        emit Withdrawn(address(0), msg.sender, amount);
    }

    // =============================================================
    //                            VIEWS
    // =============================================================

    /// @inheritdoc IChipTokenFactory
    function getChipToken(address underlying) external view override returns (address) {
        return _chipTokens[underlying];
    }

    /// @inheritdoc IChipTokenFactory
    function isChipToken(address token) external view override returns (bool) {
        return _validChipTokens[token];
    }

    // =============================================================
    //                      INTERNAL FUNCTIONS
    // =============================================================

    /**
     * @dev Get existing chip token or deploy a new one for the underlying asset
     * @param underlying The underlying token (address(0) for ETH)
     * @return chipToken The chip token address
     */
    function _getOrDeploy(address underlying) internal returns (address chipToken) {
        chipToken = _chipTokens[underlying];
        if (chipToken != address(0)) return chipToken;

        // Determine name and decimals from underlying
        string memory underlyingSymbol;
        uint8 underlyingDecimals;

        if (underlying == address(0)) {
            underlyingSymbol = "ETH";
            underlyingDecimals = 18;
        } else {
            underlyingSymbol = IERC20Metadata(underlying).symbol();
            underlyingDecimals = IERC20Metadata(underlying).decimals();
        }

        // Deploy via Crane DFPkg — creates Diamond proxy with ERC20 + Permit + MintBurn
        chipToken = TOKEN_PKG.deployToken(
            string.concat("ManaMesh Chips (", underlyingSymbol, ")"),
            string.concat("mCHIP-", underlyingSymbol),
            underlyingDecimals,
            address(this), // factory is owner (can mint/burn)
            keccak256(abi.encode(underlying)) // deterministic salt per underlying
        );

        _chipTokens[underlying] = chipToken;
        _validChipTokens[chipToken] = true;

        emit ChipTokenDeployed(underlying, chipToken);
    }

    /// @notice Accept ETH transfers (for ETH deposits)
    receive() external payable { }
}
