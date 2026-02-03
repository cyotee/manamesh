// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { GameVault } from "../src/GameVault.sol";
import { ChipToken } from "../src/ChipToken.sol";
import { IGameVault } from "../src/interfaces/IGameVault.sol";
import { IChipToken } from "../src/interfaces/IChipToken.sol";
import { SignatureVerifier } from "../src/libraries/SignatureVerifier.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract GameVaultTest is Test {
    GameVault public vault;
    ChipToken public chips;

    // Test accounts with known private keys for signing
    uint256 constant ALICE_PK = 0xA11CE;
    uint256 constant BOB_PK = 0xB0B;
    uint256 constant CHARLIE_PK = 0xC4A4;

    address public alice;
    address public bob;
    address public charlie;
    address public owner;

    bytes32 public constant GAME_ID = keccak256("test-game-1");
    bytes32 public constant HAND_ID = keccak256("hand-1");

    function setUp() public {
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        charlie = vm.addr(CHARLIE_PK);

        // Deploy contracts
        chips = new ChipToken();
        vault = new GameVault(IChipToken(address(chips)));
        owner = address(this);

        // Fund accounts with ETH and chips
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(charlie, 100 ether);

        // Each player deposits and gets chips
        vm.prank(alice);
        chips.deposit{ value: 50 ether }();

        vm.prank(bob);
        chips.deposit{ value: 50 ether }();

        vm.prank(charlie);
        chips.deposit{ value: 50 ether }();
    }

    // =============================================================
    //                      JOIN GAME TESTS
    // =============================================================

    function test_joinGame_locksChips() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 10 ether);
        assertEq(chips.balanceOf(alice), 40 ether);
    }

    function test_joinGame_emitsEvent() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);

        vm.expectEmit(true, true, false, true);
        emit IGameVault.PlayerJoined(GAME_ID, alice, 10 ether);

        vault.joinGame(GAME_ID, 10 ether);
        vm.stopPrank();
    }

    function test_joinGame_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IGameVault.ZeroAmount.selector);
        vault.joinGame(GAME_ID, 0);
    }

    function test_joinGame_multiplePlayers() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        chips.approve(address(vault), 15 ether);
        vault.joinGame(GAME_ID, 15 ether);
        vm.stopPrank();

        address[] memory players = vault.getPlayers(GAME_ID);
        assertEq(players.length, 2);
        assertEq(players[0], alice);
        assertEq(players[1], bob);
    }

    function test_joinGame_additionalDeposit() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 20 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vault.joinGame(GAME_ID, 5 ether);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 15 ether);

        // Should not add duplicate player entry
        address[] memory players = vault.getPlayers(GAME_ID);
        assertEq(players.length, 1);
    }

    // =============================================================
    //                    LEAVE GAME TESTS
    // =============================================================

    function test_leaveGame_returnsChips() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vault.leaveGame(GAME_ID);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 0);
        assertEq(chips.balanceOf(alice), 50 ether);
    }

    function test_leaveGame_emitsEvent() public {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);

        vm.expectEmit(true, true, false, true);
        emit IGameVault.PlayerLeft(GAME_ID, alice, 10 ether);

        vault.leaveGame(GAME_ID);
        vm.stopPrank();
    }

    function test_leaveGame_revertsIfNoBalance() public {
        vm.prank(alice);
        vm.expectRevert(IGameVault.NothingToWithdraw.selector);
        vault.leaveGame(GAME_ID);
    }

    // =============================================================
    //                    SETTLEMENT TESTS
    // =============================================================

    function test_settleHands_transfersPotToWinner() public {
        // Setup: Alice and Bob join the game
        _setupTwoPlayerGame();

        // Create hand result where Alice wins 5 ether pot
        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 5 ether,
            finalBetHash: bytes32(0)
        });

        // Both players sign the hand result
        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        // Empty fold arrays
        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        // Settle
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Alice should have gained from the pot
        // Initial: Alice 10, Bob 10
        // After: Alice gets potAmount added, Bob loses potAmount/(players-1)
        assertTrue(vault.getEscrow(GAME_ID, alice) > 10 ether);
    }

    function test_settleHands_emitsEvent() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectEmit(true, true, true, true);
        emit IGameVault.HandSettled(GAME_ID, HAND_ID, alice, 4 ether);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsOnInvalidSignature() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        // Only Alice signs (Bob's signature missing)
        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hands[0], ALICE_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectRevert(IGameVault.InsufficientSignatures.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsOnDoubleSettlement() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        // First settlement
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Second attempt should revert
        vm.expectRevert(IGameVault.AlreadySettled.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_isHandSettled() public {
        _setupTwoPlayerGame();

        assertFalse(vault.isHandSettled(GAME_ID, HAND_ID));

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        assertTrue(vault.isHandSettled(GAME_ID, HAND_ID));
    }

    // =============================================================
    //                      FOLD AUTH TESTS
    // =============================================================

    function test_settleHands_withFold() public {
        _setupTwoPlayerGame();

        // Bob folds
        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            handId: HAND_ID, foldingPlayer: bob, authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        // Hand result - only Alice needs to sign since Bob folded
        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hands[0], ALICE_PK);

        // Should succeed with only Alice's signature
        vm.prank(alice);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        assertTrue(vault.isHandSettled(GAME_ID, HAND_ID));
    }

    function test_settleHands_withFold_revertsIfUnauthorizedSettler() public {
        _setupTwoPlayerGame();

        // Bob folds but only authorizes Alice to settle
        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        // Hand result - only Alice signs since Bob folded
        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hands[0], ALICE_PK);

        // Charlie is not authorized by Bob's FoldAuth
        vm.prank(charlie);
        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsIfFoldSigLengthMismatch() public {
        _setupTwoPlayerGame();

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = IGameVault.FoldAuth({
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: new address[](0)
        });

        // Missing fold signature
        bytes[] memory foldSigs = new bytes[](0);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](0);
        bytes[][] memory signatures = new bytes[][](0);

        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_conservesEscrow() public {
        _setupTwoPlayerGame();

        uint256 totalBefore = vault.getEscrow(GAME_ID, alice) + vault.getEscrow(GAME_ID, bob);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        uint256 totalAfter = vault.getEscrow(GAME_ID, alice) + vault.getEscrow(GAME_ID, bob);
        assertEq(totalAfter, totalBefore);
    }

    function test_settleHands_revertsIfInsufficientEscrow() public {
        _setupTwoPlayerGame();

        // Bob only has 10 ether in escrow; potAmount=11 should revert
        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 11 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectRevert(IGameVault.InsufficientEscrow.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    // =============================================================
    //                     WITHDRAW TESTS
    // =============================================================

    function test_withdraw_returnsChips() public {
        _setupTwoPlayerGame();

        // Settle a hand first
        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            winner: alice,
            potAmount: 4 ether,
            finalBetHash: bytes32(0)
        });

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hands[0], ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Alice withdraws
        uint256 aliceEscrow = vault.getEscrow(GAME_ID, alice);
        uint256 aliceChipsBefore = chips.balanceOf(alice);

        vm.prank(alice);
        vault.withdraw(GAME_ID);

        assertEq(vault.getEscrow(GAME_ID, alice), 0);
        assertEq(chips.balanceOf(alice), aliceChipsBefore + aliceEscrow);
    }

    function test_withdraw_revertsIfNoBalance() public {
        vm.prank(alice);
        vm.expectRevert(IGameVault.NothingToWithdraw.selector);
        vault.withdraw(GAME_ID);
    }

    // =============================================================
    //                      ADMIN TESTS
    // =============================================================

    function test_setAbandonmentTimeout_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert("GameVault: not owner");
        vault.setAbandonmentTimeout(1200);
    }

    function test_setAbandonmentTimeout_updatesValue() public {
        vault.setAbandonmentTimeout(1200);
        assertEq(vault.abandonmentTimeout(), 1200);
    }

    function test_setDisputeStake_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert("GameVault: not owner");
        vault.setDisputeStake(0.05 ether);
    }

    function test_setDisputeStake_updatesValue() public {
        vault.setDisputeStake(0.05 ether);
        assertEq(vault.disputeStake(), 0.05 ether);
    }

    // =============================================================
    //                   ABANDONMENT CLAIM TESTS
    // =============================================================

    function test_claimAbandonment_distributesFullEscrow() public {
        _setupTwoPlayerGame();

        // Bob is abandoned; Alice claims after timeout.
        vm.warp(100);
        uint256 abandonedAt = block.timestamp;

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = vault.getEscrow(GAME_ID, bob);

        IGameVault.Abandonment memory claim = IGameVault.Abandonment({
            gameId: GAME_ID,
            handId: HAND_ID,
            abandonedPlayer: bob,
            abandonedAt: abandonedAt,
            splitRecipients: recipients,
            splitAmounts: amounts
        });

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signAbandonment(claim, ALICE_PK);

        vm.warp(abandonedAt + vault.abandonmentTimeout() + 1);

        uint256 aliceBefore = vault.getEscrow(GAME_ID, alice);
        vault.claimAbandonment(GAME_ID, claim, sigs);
        assertEq(vault.getEscrow(GAME_ID, bob), 0);
        assertEq(vault.getEscrow(GAME_ID, alice), aliceBefore + 10 ether);
    }

    function test_claimAbandonment_revertsOnInvalidSplitSum() public {
        _setupTwoPlayerGame();

        vm.warp(100);
        uint256 abandonedAt = block.timestamp;

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether; // not equal to bob escrow (10)

        IGameVault.Abandonment memory claim = IGameVault.Abandonment({
            gameId: GAME_ID,
            handId: HAND_ID,
            abandonedPlayer: bob,
            abandonedAt: abandonedAt,
            splitRecipients: recipients,
            splitAmounts: amounts
        });

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signAbandonment(claim, ALICE_PK);

        vm.warp(abandonedAt + vault.abandonmentTimeout() + 1);

        vm.expectRevert(IGameVault.InvalidSplit.selector);
        vault.claimAbandonment(GAME_ID, claim, sigs);
    }

    function test_claimAbandonment_revertsOnWrongGameId() public {
        _setupTwoPlayerGame();

        vm.warp(100);
        uint256 abandonedAt = block.timestamp;

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

        IGameVault.Abandonment memory claim = IGameVault.Abandonment({
            gameId: keccak256("other-game"),
            handId: HAND_ID,
            abandonedPlayer: bob,
            abandonedAt: abandonedAt,
            splitRecipients: recipients,
            splitAmounts: amounts
        });

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _signAbandonment(claim, ALICE_PK);

        vm.warp(abandonedAt + vault.abandonmentTimeout() + 1);

        vm.expectRevert(IGameVault.GameNotActive.selector);
        vault.claimAbandonment(GAME_ID, claim, sigs);
    }

    // =============================================================
    //                      HELPER FUNCTIONS
    // =============================================================

    function _setupTwoPlayerGame() internal {
        vm.startPrank(alice);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        chips.approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, 10 ether);
        vm.stopPrank();
    }

    function _signHandResult(IGameVault.HandResult memory result, uint256 pk1, uint256 pk2)
        internal
        view
        returns (bytes[] memory signatures)
    {
        signatures = new bytes[](2);
        signatures[0] = _signHandResultSingle(result, pk1);
        signatures[1] = _signHandResultSingle(result, pk2);
    }

    function _signHandResultSingle(IGameVault.HandResult memory result, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = SignatureVerifier.hashHandResult(result);
        bytes32 domainSeparator = vault.DOMAIN_SEPARATOR();
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signFoldAuth(IGameVault.FoldAuth memory auth, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = SignatureVerifier.hashFoldAuth(auth);
        bytes32 domainSeparator = vault.DOMAIN_SEPARATOR();
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signAbandonment(IGameVault.Abandonment memory claim, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = SignatureVerifier.hashAbandonment(claim);
        bytes32 domainSeparator = vault.DOMAIN_SEPARATOR();
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
