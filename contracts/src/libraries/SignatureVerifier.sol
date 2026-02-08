// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { IGameVault } from "../interfaces/IGameVault.sol";

/**
 * @title SignatureVerifier
 * @notice Library for EIP-712 typed data signature verification
 * @dev Provides type hashes and verification for all ManaMesh game types
 */
library SignatureVerifier {
    using ECDSA for bytes32;

    // =============================================================
    //                         TYPE HASHES
    // =============================================================

    /// @dev keccak256("Bet(bytes32 handId,address bettor,uint256 betIndex,uint8 action,uint256 amount,bytes32 previousBetHash)")
    bytes32 internal constant BET_TYPEHASH = keccak256(
        "Bet(bytes32 handId,address bettor,uint256 betIndex,uint8 action,uint256 amount,bytes32 previousBetHash)"
    );

    /// @dev keccak256("HandResult(bytes32 gameId,bytes32 handId,bytes32 finalBetHash,address[] players,int256[] deltas)")
    bytes32 internal constant HAND_RESULT_TYPEHASH = keccak256(
        "HandResult(bytes32 gameId,bytes32 handId,bytes32 finalBetHash,address[] players,int256[] deltas)"
    );

    /// @dev keccak256("FoldAuth(bytes32 gameId,bytes32 handId,address foldingPlayer,address[] authorizedSettlers)")
    bytes32 internal constant FOLD_AUTH_TYPEHASH = keccak256(
        "FoldAuth(bytes32 gameId,bytes32 handId,address foldingPlayer,address[] authorizedSettlers)"
    );

    /// @dev keccak256("Abandonment(bytes32 gameId,bytes32 handId,address abandonedPlayer,uint256 abandonedAt,address[] splitRecipients,uint256[] splitAmounts)")
    bytes32 internal constant ABANDONMENT_TYPEHASH = keccak256(
        "Abandonment(bytes32 gameId,bytes32 handId,address abandonedPlayer,uint256 abandonedAt,address[] splitRecipients,uint256[] splitAmounts)"
    );

    // =============================================================
    //                      HASH FUNCTIONS
    // =============================================================

    /**
     * @notice Hash a Bet struct
     * @param bet The bet to hash
     * @return The struct hash
     */
    function hashBet(IGameVault.Bet memory bet) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                BET_TYPEHASH, bet.handId, bet.bettor, bet.betIndex, bet.action, bet.amount, bet.previousBetHash
            )
        );
    }

    /**
     * @notice Hash a HandResult struct
     * @param result The hand result to hash
     * @return The struct hash
     */
    function hashHandResult(IGameVault.HandResult memory result) internal pure returns (bytes32) {
        bytes32 playersHash = _hashAddressArray(result.players);
        bytes32 deltasHash = _hashInt256Array(result.deltas);
        return keccak256(
            abi.encode(
                HAND_RESULT_TYPEHASH,
                result.gameId,
                result.handId,
                result.finalBetHash,
                playersHash,
                deltasHash
            )
        );
    }

    /**
     * @notice Hash a FoldAuth struct
     * @param auth The fold authorization to hash
     * @return The struct hash
     */
    function hashFoldAuth(IGameVault.FoldAuth memory auth) internal pure returns (bytes32) {
        bytes32 authorizedSettlersHash = _hashAddressArray(auth.authorizedSettlers);
        return keccak256(
            abi.encode(
                FOLD_AUTH_TYPEHASH,
                auth.gameId,
                auth.handId,
                auth.foldingPlayer,
                authorizedSettlersHash
            )
        );
    }

    /**
     * @notice Hash an Abandonment struct
     * @param claim The abandonment claim to hash
     * @return The struct hash
     */
    function hashAbandonment(IGameVault.Abandonment memory claim) internal pure returns (bytes32) {
        bytes32 recipientsHash = _hashAddressArray(claim.splitRecipients);
        bytes32 amountsHash = _hashUint256Array(claim.splitAmounts);
        return keccak256(
            abi.encode(
                ABANDONMENT_TYPEHASH,
                claim.gameId,
                claim.handId,
                claim.abandonedPlayer,
                claim.abandonedAt,
                recipientsHash,
                amountsHash
            )
        );
    }

    // =============================================================
    //                        ARRAY HASHING
    // =============================================================

    /// @dev EIP-712 array hash for address[]: keccak256(concat(abi.encode(address_i)))
    function _hashAddressArray(address[] memory addrs) private pure returns (bytes32) {
        bytes memory packed = new bytes(addrs.length * 32);
        for (uint256 i = 0; i < addrs.length; i++) {
            bytes32 word = bytes32(uint256(uint160(addrs[i])));
            assembly {
                mstore(add(add(packed, 0x20), mul(i, 0x20)), word)
            }
        }
        return keccak256(packed);
    }

    /// @dev EIP-712 array hash for uint256[]: keccak256(concat(encodeData(uint256_i)))
    ///      abi.encodePacked on uint256[] concatenates each as 32-byte words
    function _hashUint256Array(uint256[] memory values) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(values));
    }

    /// @dev EIP-712 array hash for int256[]: keccak256(concat(encodeData(int256_i)))
    ///      abi.encodePacked on int256[] concatenates each as 32-byte words
    function _hashInt256Array(int256[] memory values) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(values));
    }

    // =============================================================
    //                    SIGNATURE VERIFICATION
    // =============================================================

    /**
     * @notice Recover signer from typed data signature
     * @param domainSeparator The EIP-712 domain separator
     * @param structHash The struct hash
     * @param signature The signature bytes
     * @return The recovered signer address
     */
    function recoverSigner(bytes32 domainSeparator, bytes32 structHash, bytes memory signature)
        internal
        pure
        returns (address)
    {
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);
        return digest.recover(signature);
    }

    /**
     * @notice Verify a signature is from an expected signer
     * @param domainSeparator The EIP-712 domain separator
     * @param structHash The struct hash
     * @param signature The signature bytes
     * @param expectedSigner The expected signer address
     * @return True if signature is valid and from expected signer
     */
    function verify(
        bytes32 domainSeparator,
        bytes32 structHash,
        bytes memory signature,
        address expectedSigner
    ) internal pure returns (bool) {
        return recoverSigner(domainSeparator, structHash, signature) == expectedSigner;
    }

    /**
     * @notice Verify signatures from multiple signers
     * @param domainSeparator The EIP-712 domain separator
     * @param structHash The struct hash
     * @param signatures Array of signatures
     * @param expectedSigners Array of expected signers
     * @return True if all signatures valid and from expected signers
     */
    function verifyMultiple(
        bytes32 domainSeparator,
        bytes32 structHash,
        bytes[] memory signatures,
        address[] memory expectedSigners
    ) internal pure returns (bool) {
        if (signatures.length != expectedSigners.length) return false;

        for (uint256 i = 0; i < signatures.length; i++) {
            if (!verify(domainSeparator, structHash, signatures[i], expectedSigners[i])) {
                return false;
            }
        }
        return true;
    }

    /**
     * @notice Verify bet chain integrity
     * @param domainSeparator The EIP-712 domain separator
     * @param bets The chain of bets (each bet declares its own bettor)
     * @param signatures Signatures for each bet
     * @return True if chain is valid and all bets properly signed
     */
    function verifyBetChain(
        bytes32 domainSeparator,
        IGameVault.Bet[] memory bets,
        bytes[] memory signatures
    ) internal pure returns (bool) {
        if (bets.length != signatures.length) return false;
        if (bets.length == 0) return false;

        // First bet must have zero previousBetHash
        if (bets[0].previousBetHash != bytes32(0)) return false;

        bytes32 previousHash = bytes32(0);

        for (uint256 i = 0; i < bets.length; i++) {
            // Verify chain linkage
            if (bets[i].previousBetHash != previousHash) return false;

            // Verify bet index
            if (bets[i].betIndex != i) return false;

            // Verify signature matches the bet's declared bettor
            bytes32 betHash = hashBet(bets[i]);
            if (!verify(domainSeparator, betHash, signatures[i], bets[i].bettor)) {
                return false;
            }

            // Update chain
            previousHash = betHash;
        }

        return true;
    }
}
