// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Permit } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import { GameVault } from "../src/GameVault.sol";
import { ChipTokenFactory } from "../src/ChipTokenFactory.sol";
import { IGameVault } from "../src/interfaces/IGameVault.sol";
import { IChipTokenFactory } from "../src/interfaces/IChipTokenFactory.sol";
import { SignatureVerifier } from "../src/libraries/SignatureVerifier.sol";

// Crane imports for DFPkg infrastructure
import { InitDevService } from "@crane/contracts/InitDevService.sol";
import { ICreate3Factory } from "@crane/contracts/interfaces/ICreate3Factory.sol";
import { IDiamondPackageCallBackFactory } from
    "@crane/contracts/interfaces/IDiamondPackageCallBackFactory.sol";
import { IFacet } from "@crane/contracts/interfaces/IFacet.sol";
import { BetterEfficientHashLib } from "@crane/contracts/utils/BetterEfficientHashLib.sol";
import { ERC20Facet } from "@crane/contracts/tokens/ERC20/ERC20Facet.sol";
import { ERC5267Facet } from "@crane/contracts/utils/cryptography/ERC5267/ERC5267Facet.sol";
import { ERC2612Facet } from "@crane/contracts/tokens/ERC2612/ERC2612Facet.sol";
import { ERC20MintBurnOwnableFacet } from
    "@crane/contracts/tokens/ERC20/ERC20MintBurnOwnableFacet.sol";
import {
    IERC20PermitMintBurnLockedOwnableDFPkg,
    ERC20PermitMintBurnLockedOwnableDFPkg
} from "@crane/contracts/tokens/ERC20/ERC20PermitMintBurnLockedOwnableDFPkg.sol";

/// @dev Simple mock ERC20 for use as underlying asset in tests
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) { }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GameVaultTest is Test {
    using BetterEfficientHashLib for bytes;

    GameVault public vault;
    ChipTokenFactory public chipFactory;
    MockERC20 public underlying;
    address public chipToken;

    // Test accounts with known private keys for signing
    uint256 constant ALICE_PK = 0xA11CE;
    uint256 constant BOB_PK = 0xB0B;
    uint256 constant CHARLIE_PK = 0xC4A4;

    address public alice;
    address public bob;
    address public charlie;

    bytes32 public constant GAME_ID = keccak256("test-game-1");
    bytes32 public constant HAND_ID = keccak256("hand-1");

    function setUp() public {
        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        charlie = vm.addr(CHARLIE_PK);

        // ---- Crane DFPkg Infrastructure ----
        (ICreate3Factory create3Factory, IDiamondPackageCallBackFactory diamondFactory) =
            InitDevService.initEnv(address(this));

        IFacet erc20Facet = create3Factory.deployFacet(
            type(ERC20Facet).creationCode, abi.encode(type(ERC20Facet).name)._hash()
        );
        IFacet erc5267Facet = create3Factory.deployFacet(
            type(ERC5267Facet).creationCode, abi.encode(type(ERC5267Facet).name)._hash()
        );
        IFacet erc2612Facet = create3Factory.deployFacet(
            type(ERC2612Facet).creationCode, abi.encode(type(ERC2612Facet).name)._hash()
        );
        IFacet mintBurnFacet = create3Factory.deployFacet(
            type(ERC20MintBurnOwnableFacet).creationCode,
            abi.encode(type(ERC20MintBurnOwnableFacet).name)._hash()
        );

        IERC20PermitMintBurnLockedOwnableDFPkg tokenPkg =
        IERC20PermitMintBurnLockedOwnableDFPkg(
            address(
                new ERC20PermitMintBurnLockedOwnableDFPkg(
                    IERC20PermitMintBurnLockedOwnableDFPkg.PkgInit({
                        erc20Facet: erc20Facet,
                        erc5267Facet: erc5267Facet,
                        erc2612Facet: erc2612Facet,
                        erc20MintBurnOwnableFacet: mintBurnFacet,
                        diamondFactory: diamondFactory
                    })
                )
            )
        );

        // ---- Application Contracts ----
        chipFactory = new ChipTokenFactory(tokenPkg);
        vault = new GameVault(IChipTokenFactory(address(chipFactory)));

        // ---- Mock Underlying Token ----
        underlying = new MockERC20("Test Token", "TEST");

        // ---- Fund & Deposit ----
        underlying.mint(alice, 100 ether);
        underlying.mint(bob, 100 ether);
        underlying.mint(charlie, 100 ether);

        vm.startPrank(alice);
        IERC20(address(underlying)).approve(address(chipFactory), type(uint256).max);
        chipFactory.deposit(address(underlying), 50 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(address(underlying)).approve(address(chipFactory), type(uint256).max);
        chipFactory.deposit(address(underlying), 50 ether);
        vm.stopPrank();

        vm.startPrank(charlie);
        IERC20(address(underlying)).approve(address(chipFactory), type(uint256).max);
        chipFactory.deposit(address(underlying), 50 ether);
        vm.stopPrank();

        // Get the chip token address
        chipToken = chipFactory.getChipToken(address(underlying));
    }

    // =============================================================
    //                      JOIN GAME TESTS
    // =============================================================

    function test_joinGame_locksChips() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 10 ether);
        assertEq(IERC20(chipToken).balanceOf(alice), 40 ether);
    }

    function test_joinGame_emitsEvent() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);

        vm.expectEmit(true, true, false, true);
        emit IGameVault.PlayerJoined(GAME_ID, alice, 10 ether);

        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();
    }

    function test_joinGame_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IGameVault.ZeroAmount.selector);
        vault.joinGame(GAME_ID, chipToken, 0);
    }

    function test_joinGame_multiplePlayers() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(chipToken).approve(address(vault), 15 ether);
        vault.joinGame(GAME_ID, chipToken, 15 ether);
        vm.stopPrank();

        address[] memory players = vault.getPlayers(GAME_ID);
        assertEq(players.length, 2);
        assertEq(players[0], alice);
        assertEq(players[1], bob);
    }

    function test_joinGame_additionalDeposit() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 20 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vault.joinGame(GAME_ID, chipToken, 5 ether);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 15 ether);

        // Should not add duplicate player entry
        address[] memory players = vault.getPlayers(GAME_ID);
        assertEq(players.length, 1);
    }

    function test_joinGame_revertsOnInvalidChipToken() public {
        vm.prank(alice);
        vm.expectRevert(IGameVault.InvalidChipToken.selector);
        vault.joinGame(GAME_ID, address(underlying), 10 ether);
    }

    function test_joinGame_revertsOnChipTokenMismatch() public {
        // First player joins with the TEST chip token
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();

        // Deploy a second underlying and chip token
        MockERC20 underlying2 = new MockERC20("Other Token", "OTH");
        underlying2.mint(bob, 100 ether);
        vm.startPrank(bob);
        IERC20(address(underlying2)).approve(address(chipFactory), type(uint256).max);
        chipFactory.deposit(address(underlying2), 50 ether);
        address chipToken2 = chipFactory.getChipToken(address(underlying2));
        IERC20(chipToken2).approve(address(vault), 10 ether);

        // Bob tries to join the same game with a different chip token
        vm.expectRevert(IGameVault.ChipTokenMismatch.selector);
        vault.joinGame(GAME_ID, chipToken2, 10 ether);
        vm.stopPrank();
    }

    function test_joinGameWithPermit() public {
        uint256 amount = 10 ether;
        uint256 deadline = block.timestamp + 1 hours;

        // Get permit nonce and domain from the chip token
        uint256 nonce = IERC20Permit(chipToken).nonces(alice);
        bytes32 domainSeparator = IERC20Permit(chipToken).DOMAIN_SEPARATOR();

        bytes32 permitTypehash = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );
        bytes32 structHash = keccak256(
            abi.encode(permitTypehash, alice, address(vault), amount, nonce, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_PK, digest);

        vm.prank(alice);
        vault.joinGameWithPermit(GAME_ID, chipToken, amount, deadline, v, r, s);

        assertEq(vault.getEscrow(GAME_ID, alice), amount);
    }

    // =============================================================
    //                    LEAVE GAME TESTS
    // =============================================================

    function test_leaveGame_returnsChips() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vault.leaveGame(GAME_ID);
        vm.stopPrank();

        assertEq(vault.getEscrow(GAME_ID, alice), 0);
        assertEq(IERC20(chipToken).balanceOf(alice), 50 ether);
    }

    function test_leaveGame_emitsEvent() public {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);

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

    function test_settleHands_transfersDeltasCorrectly() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 5 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Alice: 10 + 5 = 15, Bob: 10 - 5 = 5
        assertEq(vault.getEscrow(GAME_ID, alice), 15 ether);
        assertEq(vault.getEscrow(GAME_ID, bob), 5 ether);
    }

    function test_settleHands_emitsEvent() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectEmit(true, true, false, false);
        emit IGameVault.HandSettled(GAME_ID, HAND_ID);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsOnInvalidSignature() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        // Only Alice signs (Bob's signature missing)
        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hand, ALICE_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectRevert(IGameVault.InsufficientSignatures.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsOnDoubleSettlement() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        vm.expectRevert(IGameVault.AlreadySettled.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_isHandSettled() public {
        _setupTwoPlayerGame();

        assertFalse(vault.isHandSettled(GAME_ID, HAND_ID));

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        assertTrue(vault.isHandSettled(GAME_ID, HAND_ID));
    }

    function test_settleHands_conservesEscrow() public {
        _setupTwoPlayerGame();

        uint256 totalBefore = vault.getEscrow(GAME_ID, alice) + vault.getEscrow(GAME_ID, bob);

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        uint256 totalAfter = vault.getEscrow(GAME_ID, alice) + vault.getEscrow(GAME_ID, bob);
        assertEq(totalAfter, totalBefore, "Total escrow must be conserved");
    }

    function test_settleHands_revertsIfInsufficientEscrow() public {
        _setupTwoPlayerGame();

        // Bob only has 10 ether in escrow; delta of -11 should revert
        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 11 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectRevert(IGameVault.InsufficientEscrow.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsIfDeltasDontSumToZero() public {
        _setupTwoPlayerGame();

        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        deltas[0] = int256(5 ether);
        deltas[1] = int256(-3 ether); // Sum = +2 (not zero)

        IGameVault.HandResult memory hand = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            finalBetHash: bytes32(0),
            players: players,
            deltas: deltas
        });

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vm.expectRevert(IGameVault.DeltasNotBalanced.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_multipleHandsBatch() public {
        _setupTwoPlayerGame();

        bytes32 handId2 = keccak256("hand-2");

        IGameVault.HandResult memory hand1 = _makeHandResult(GAME_ID, HAND_ID, 3 ether);
        IGameVault.HandResult memory hand2 = _makeHandResultBobWins(GAME_ID, handId2, 2 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](2);
        hands[0] = hand1;
        hands[1] = hand2;

        bytes[][] memory signatures = new bytes[][](2);
        signatures[0] = _signHandResult(hand1, ALICE_PK, BOB_PK);
        signatures[1] = _signHandResult(hand2, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Alice: 10 + 3 - 2 = 11, Bob: 10 - 3 + 2 = 9
        assertEq(vault.getEscrow(GAME_ID, alice), 11 ether);
        assertEq(vault.getEscrow(GAME_ID, bob), 9 ether);
    }

    // =============================================================
    //                      FOLD AUTH TESTS
    // =============================================================

    function test_settleHands_withFold() public {
        _setupTwoPlayerGame();

        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            gameId: GAME_ID,
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hand, ALICE_PK);

        vm.prank(alice);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        assertTrue(vault.isHandSettled(GAME_ID, HAND_ID));
    }

    function test_settleHands_withFold_revertsIfUnauthorizedSettler() public {
        _setupTwoPlayerGame();

        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            gameId: GAME_ID,
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = new bytes[](1);
        signatures[0][0] = _signHandResultSingle(hand, ALICE_PK);

        // Charlie is not authorized by Bob's FoldAuth
        vm.prank(charlie);
        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_revertsIfFoldSigLengthMismatch() public {
        _setupTwoPlayerGame();

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = IGameVault.FoldAuth({
            gameId: GAME_ID,
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: new address[](0)
        });

        bytes[] memory foldSigs = new bytes[](0);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](0);
        bytes[][] memory signatures = new bytes[][](0);

        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_withFold_revertsIfWrongGameId() public {
        _setupTwoPlayerGame();

        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        // FoldAuth has wrong gameId
        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            gameId: keccak256("other-game"),
            handId: HAND_ID,
            foldingPlayer: bob,
            authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](0);
        bytes[][] memory signatures = new bytes[][](0);

        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    function test_settleHands_withFold_revertsIfNotInGame() public {
        _setupTwoPlayerGame();

        address[] memory settlers = new address[](1);
        settlers[0] = alice;

        // Charlie is not in the game
        IGameVault.FoldAuth memory fold = IGameVault.FoldAuth({
            gameId: GAME_ID,
            handId: HAND_ID,
            foldingPlayer: charlie,
            authorizedSettlers: settlers
        });

        bytes[] memory foldSigs = new bytes[](1);
        foldSigs[0] = _signFoldAuth(fold, CHARLIE_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](1);
        folds[0] = fold;

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](0);
        bytes[][] memory signatures = new bytes[][](0);

        vm.expectRevert(IGameVault.InvalidFoldAuth.selector);
        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }

    // =============================================================
    //                     WITHDRAW TESTS
    // =============================================================

    function test_withdraw_returnsChips() public {
        _setupTwoPlayerGame();

        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        uint256 aliceEscrow = vault.getEscrow(GAME_ID, alice);
        uint256 aliceChipsBefore = IERC20(chipToken).balanceOf(alice);

        vm.prank(alice);
        vault.withdraw(GAME_ID);

        assertEq(vault.getEscrow(GAME_ID, alice), 0);
        assertEq(IERC20(chipToken).balanceOf(alice), aliceChipsBefore + aliceEscrow);
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

    function test_claimAbandonment_revertsBeforeTimeout() public {
        _setupTwoPlayerGame();

        vm.warp(100);
        uint256 abandonedAt = block.timestamp;

        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

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

        vm.expectRevert(IGameVault.TimeoutNotReached.selector);
        vault.claimAbandonment(GAME_ID, claim, sigs);
    }

    // =============================================================
    //                       DISPUTE TESTS
    // =============================================================

    function test_disputeHand_revertsIfHandNotSettled() public {
        _setupTwoPlayerGame();

        IGameVault.Bet[] memory betChain = new IGameVault.Bet[](0);
        bytes[] memory betSigs = new bytes[](0);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(IGameVault.HandNotSettled.selector);
        vault.disputeHand{ value: 0.01 ether }(GAME_ID, HAND_ID, betChain, betSigs);
    }

    function test_disputeHand_revertsIfStakeInsufficient() public {
        _setupTwoPlayerGame();
        _settleOneHand();

        IGameVault.Bet[] memory betChain = new IGameVault.Bet[](0);
        bytes[] memory betSigs = new bytes[](0);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(IGameVault.DisputeStakeRequired.selector);
        vault.disputeHand{ value: 0.001 ether }(GAME_ID, HAND_ID, betChain, betSigs);
    }

    function test_disputeHand_successfulDispute_foldedPlayerGivenPositiveDelta() public {
        _setupTwoPlayerGame();

        // Build a bet chain where bob folds
        IGameVault.Bet[] memory betChain = new IGameVault.Bet[](2);
        bytes[] memory betSigs = new bytes[](2);

        // Alice raises 2 ether
        betChain[0] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: alice,
            betIndex: 0,
            action: 3, // raise
            amount: 2 ether,
            previousBetHash: bytes32(0)
        });
        betSigs[0] = _signBet(betChain[0], ALICE_PK);

        // Bob folds
        betChain[1] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: bob,
            betIndex: 1,
            action: 0, // fold
            amount: 0,
            previousBetHash: SignatureVerifier.hashBet(betChain[0])
        });
        betSigs[1] = _signBet(betChain[1], BOB_PK);

        // Fraudulent settlement: bob folded but is given +4 delta (alice -4)
        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        deltas[0] = -int256(4 ether);
        deltas[1] = int256(4 ether);

        IGameVault.HandResult memory hand = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            finalBetHash: bytes32(0),
            players: players,
            deltas: deltas
        });

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        // Bob cheated: folded but got positive delta
        uint256 aliceEscrowBefore = vault.getEscrow(GAME_ID, alice);
        uint256 bobEscrowBefore = vault.getEscrow(GAME_ID, bob);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vault.disputeHand{ value: 0.01 ether }(GAME_ID, HAND_ID, betChain, betSigs);

        // After dispute: settlement reversed, folded players lose contributions (bob had 0),
        // non-folded get folded pot (also 0 since bob contributed 0 before folding).
        // Net effect: back to pre-settlement escrow (10 each) since pot from folds is 0.
        uint256 aliceEscrowAfter = vault.getEscrow(GAME_ID, alice);
        uint256 bobEscrowAfter = vault.getEscrow(GAME_ID, bob);

        // The settlement was reversed (alice gets +4 back, bob loses +4)
        // then dispute settlement applies (no pot from folds since bob contributed 0)
        assertEq(aliceEscrowAfter, 10 ether, "Alice escrow should be restored");
        assertEq(bobEscrowAfter, 10 ether, "Bob escrow should be restored");
    }

    function test_disputeHand_noFraud_challengerLosesStake() public {
        _setupTwoPlayerGame();

        // Build a valid bet chain: alice raises, bob calls
        IGameVault.Bet[] memory betChain = new IGameVault.Bet[](2);
        bytes[] memory betSigs = new bytes[](2);

        betChain[0] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: alice,
            betIndex: 0,
            action: 3, // raise
            amount: 4 ether,
            previousBetHash: bytes32(0)
        });
        betSigs[0] = _signBet(betChain[0], ALICE_PK);

        betChain[1] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: bob,
            betIndex: 1,
            action: 2, // call
            amount: 4 ether,
            previousBetHash: SignatureVerifier.hashBet(betChain[0])
        });
        betSigs[1] = _signBet(betChain[1], BOB_PK);

        // Legitimate settlement: alice wins 4 (delta +4), bob loses 4 (delta -4)
        _settleOneHand(); // This settles alice +4, bob -4

        // Challenge: no fraud since alice contributed 4, bob contributed 4, alice wins
        uint256 challengerBalBefore = bob.balance;

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vault.disputeHand{ value: 0.01 ether }(GAME_ID, HAND_ID, betChain, betSigs);

        // Bob (challenger) loses stake — contract keeps it
        assertEq(bob.balance, 1 ether - 0.01 ether, "Challenger should lose dispute stake");

        // Escrow unchanged
        assertEq(vault.getEscrow(GAME_ID, alice), 14 ether);
        assertEq(vault.getEscrow(GAME_ID, bob), 6 ether);
    }

    function test_disputeHand_revertsOnDoubleDispute() public {
        _setupTwoPlayerGame();

        // Build bet chain where bob folds
        IGameVault.Bet[] memory betChain = new IGameVault.Bet[](2);
        bytes[] memory betSigs = new bytes[](2);

        betChain[0] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: alice,
            betIndex: 0,
            action: 3,
            amount: 2 ether,
            previousBetHash: bytes32(0)
        });
        betSigs[0] = _signBet(betChain[0], ALICE_PK);

        betChain[1] = IGameVault.Bet({
            handId: HAND_ID,
            bettor: bob,
            betIndex: 1,
            action: 0,
            amount: 0,
            previousBetHash: SignatureVerifier.hashBet(betChain[0])
        });
        betSigs[1] = _signBet(betChain[1], BOB_PK);

        // Fraudulent settlement: bob folded but gets positive delta
        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        deltas[0] = -int256(4 ether);
        deltas[1] = int256(4 ether);

        IGameVault.HandResult memory hand = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            finalBetHash: bytes32(0),
            players: players,
            deltas: deltas
        });

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);

        vm.deal(alice, 2 ether);

        // First dispute succeeds
        vm.prank(alice);
        vault.disputeHand{ value: 0.01 ether }(GAME_ID, HAND_ID, betChain, betSigs);

        // Second dispute reverts
        vm.prank(alice);
        vm.expectRevert(IGameVault.AlreadyDisputed.selector);
        vault.disputeHand{ value: 0.01 ether }(GAME_ID, HAND_ID, betChain, betSigs);
    }

    // =============================================================
    //                   CHIP TOKEN FACTORY TESTS
    // =============================================================

    function test_chipFactory_deploysPerAsset() public {
        assertTrue(chipFactory.isChipToken(chipToken));
        assertEq(chipFactory.getChipToken(address(underlying)), chipToken);
    }

    function test_chipFactory_depositAndWithdraw() public {
        // Alice has 50 ether in underlying remaining, 50 ether in chips
        assertEq(underlying.balanceOf(alice), 50 ether);
        assertEq(IERC20(chipToken).balanceOf(alice), 50 ether);

        // Withdraw 10 chips → get 10 underlying back
        vm.prank(alice);
        chipFactory.withdraw(address(underlying), 10 ether);

        assertEq(underlying.balanceOf(alice), 60 ether);
        assertEq(IERC20(chipToken).balanceOf(alice), 40 ether);
    }

    function test_chipFactory_multipleUnderlying() public {
        MockERC20 dai = new MockERC20("Dai Stablecoin", "DAI");
        dai.mint(alice, 100 ether);

        vm.startPrank(alice);
        IERC20(address(dai)).approve(address(chipFactory), type(uint256).max);
        chipFactory.deposit(address(dai), 25 ether);
        vm.stopPrank();

        address chipDAI = chipFactory.getChipToken(address(dai));
        assertTrue(chipDAI != address(0));
        assertTrue(chipDAI != chipToken); // Different from TEST chip token
        assertTrue(chipFactory.isChipToken(chipDAI));
        assertEq(IERC20(chipDAI).balanceOf(alice), 25 ether);
    }

    function test_chipFactory_ethDeposit() public {
        vm.deal(alice, 10 ether);

        vm.prank(alice);
        chipFactory.depositETH{ value: 5 ether }();

        address chipETH = chipFactory.getChipToken(address(0));
        assertTrue(chipETH != address(0));
        assertTrue(chipFactory.isChipToken(chipETH));
        assertEq(IERC20(chipETH).balanceOf(alice), 5 ether);
    }

    // =============================================================
    //                   PER-GAME CHIP TOKEN TESTS
    // =============================================================

    function test_gameChipToken_setOnFirstJoin() public {
        assertEq(vault.gameChipToken(GAME_ID), address(0));

        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();

        assertEq(vault.gameChipToken(GAME_ID), chipToken);
    }

    // =============================================================
    //                  EIP-712 CROSS-CHECK TESTS
    // =============================================================

    function test_domainSeparator_matchesManualComputation() public view {
        bytes32 TYPE_HASH =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 expected = keccak256(
            abi.encode(TYPE_HASH, keccak256("ManaMesh"), keccak256("1"), block.chainid, address(vault))
        );
        assertEq(vault.DOMAIN_SEPARATOR(), expected, "Domain separator mismatch");
    }

    function test_handResultHash_matchesManualEIP712() public view {
        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        deltas[0] = int256(3 ether);
        deltas[1] = -int256(3 ether);

        IGameVault.HandResult memory hand = IGameVault.HandResult({
            gameId: GAME_ID,
            handId: HAND_ID,
            finalBetHash: bytes32(uint256(0xdead)),
            players: players,
            deltas: deltas
        });

        // Manual EIP-712 struct hash
        bytes32 HAND_RESULT_TYPEHASH = keccak256(
            "HandResult(bytes32 gameId,bytes32 handId,bytes32 finalBetHash,address[] players,int256[] deltas)"
        );

        // EIP-712: array hash = keccak256(concat(encodeData(elem_i)))
        // For address: encodeData = left-pad to 32 bytes
        bytes32 playersHash = keccak256(
            abi.encodePacked(bytes32(uint256(uint160(alice))), bytes32(uint256(uint160(bob))))
        );
        // For int256: encodeData = abi.encode (already 32 bytes)
        bytes32 deltasHash = keccak256(abi.encodePacked(deltas));

        bytes32 expected = keccak256(
            abi.encode(HAND_RESULT_TYPEHASH, GAME_ID, HAND_ID, bytes32(uint256(0xdead)), playersHash, deltasHash)
        );

        assertEq(SignatureVerifier.hashHandResult(hand), expected, "HandResult hash mismatch");
    }

    function test_betHash_matchesManualEIP712() public pure {
        IGameVault.Bet memory bet = IGameVault.Bet({
            handId: keccak256("test-hand"),
            bettor: address(0x1234),
            betIndex: 0,
            action: 3, // raise
            amount: 5 ether,
            previousBetHash: bytes32(0)
        });

        bytes32 BET_TYPEHASH = keccak256(
            "Bet(bytes32 handId,address bettor,uint256 betIndex,uint8 action,uint256 amount,bytes32 previousBetHash)"
        );

        bytes32 expected = keccak256(
            abi.encode(
                BET_TYPEHASH, bet.handId, bet.bettor, bet.betIndex, bet.action, bet.amount, bet.previousBetHash
            )
        );

        assertEq(SignatureVerifier.hashBet(bet), expected, "Bet hash mismatch");
    }

    function test_foldAuthHash_matchesManualEIP712() public view {
        address[] memory settlers = new address[](2);
        settlers[0] = alice;
        settlers[1] = bob;

        IGameVault.FoldAuth memory auth = IGameVault.FoldAuth({
            gameId: GAME_ID,
            handId: HAND_ID,
            foldingPlayer: charlie,
            authorizedSettlers: settlers
        });

        bytes32 FOLD_AUTH_TYPEHASH = keccak256(
            "FoldAuth(bytes32 gameId,bytes32 handId,address foldingPlayer,address[] authorizedSettlers)"
        );

        bytes32 settlersHash = keccak256(
            abi.encodePacked(bytes32(uint256(uint160(alice))), bytes32(uint256(uint160(bob))))
        );

        bytes32 expected =
            keccak256(abi.encode(FOLD_AUTH_TYPEHASH, GAME_ID, HAND_ID, charlie, settlersHash));

        assertEq(SignatureVerifier.hashFoldAuth(auth), expected, "FoldAuth hash mismatch");
    }

    function test_abandonmentHash_matchesManualEIP712() public view {
        address[] memory recipients = new address[](1);
        recipients[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10 ether;

        IGameVault.Abandonment memory claim = IGameVault.Abandonment({
            gameId: GAME_ID,
            handId: HAND_ID,
            abandonedPlayer: bob,
            abandonedAt: 12345,
            splitRecipients: recipients,
            splitAmounts: amounts
        });

        bytes32 ABANDONMENT_TYPEHASH = keccak256(
            "Abandonment(bytes32 gameId,bytes32 handId,address abandonedPlayer,uint256 abandonedAt,address[] splitRecipients,uint256[] splitAmounts)"
        );

        bytes32 recipientsHash = keccak256(abi.encodePacked(bytes32(uint256(uint160(alice)))));
        bytes32 amountsHash = keccak256(abi.encodePacked(amounts));

        bytes32 expected = keccak256(
            abi.encode(ABANDONMENT_TYPEHASH, GAME_ID, HAND_ID, bob, uint256(12345), recipientsHash, amountsHash)
        );

        assertEq(SignatureVerifier.hashAbandonment(claim), expected, "Abandonment hash mismatch");
    }

    function test_fullTypedDataDigest_matchesExpected() public view {
        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);
        bytes32 structHash = SignatureVerifier.hashHandResult(hand);
        bytes32 domainSep = vault.DOMAIN_SEPARATOR();

        // EIP-712 typed data: "\x19\x01" || domainSeparator || structHash
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        bytes32 actual = MessageHashUtils.toTypedDataHash(domainSep, structHash);

        assertEq(actual, expected, "Full typed data digest mismatch");
    }

    // =============================================================
    //                      HELPER FUNCTIONS
    // =============================================================

    function _setupTwoPlayerGame() internal {
        vm.startPrank(alice);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        IERC20(chipToken).approve(address(vault), 10 ether);
        vault.joinGame(GAME_ID, chipToken, 10 ether);
        vm.stopPrank();
    }

    /// @dev Create a HandResult where alice wins `winAmount` from bob
    function _makeHandResult(bytes32 gameId, bytes32 handId, uint256 winAmount)
        internal
        view
        returns (IGameVault.HandResult memory)
    {
        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        // forge-lint: disable-next-line(unsafe-typecast)
        deltas[0] = int256(winAmount);
        // forge-lint: disable-next-line(unsafe-typecast)
        deltas[1] = -int256(winAmount);

        return IGameVault.HandResult({
            gameId: gameId,
            handId: handId,
            finalBetHash: bytes32(0),
            players: players,
            deltas: deltas
        });
    }

    /// @dev Create a HandResult where bob wins `winAmount` from alice
    function _makeHandResultBobWins(bytes32 gameId, bytes32 handId, uint256 winAmount)
        internal
        view
        returns (IGameVault.HandResult memory)
    {
        address[] memory players = new address[](2);
        players[0] = alice;
        players[1] = bob;
        int256[] memory deltas = new int256[](2);
        // forge-lint: disable-next-line(unsafe-typecast)
        deltas[0] = -int256(winAmount);
        // forge-lint: disable-next-line(unsafe-typecast)
        deltas[1] = int256(winAmount);

        return IGameVault.HandResult({
            gameId: gameId,
            handId: handId,
            finalBetHash: bytes32(0),
            players: players,
            deltas: deltas
        });
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

    function _signBet(IGameVault.Bet memory bet, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = SignatureVerifier.hashBet(bet);
        bytes32 domainSeparator = vault.DOMAIN_SEPARATOR();
        bytes32 digest = MessageHashUtils.toTypedDataHash(domainSeparator, structHash);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Settle a standard hand for dispute tests
    function _settleOneHand() internal {
        IGameVault.HandResult memory hand = _makeHandResult(GAME_ID, HAND_ID, 4 ether);

        IGameVault.HandResult[] memory hands = new IGameVault.HandResult[](1);
        hands[0] = hand;

        bytes[][] memory signatures = new bytes[][](1);
        signatures[0] = _signHandResult(hand, ALICE_PK, BOB_PK);

        IGameVault.FoldAuth[] memory folds = new IGameVault.FoldAuth[](0);
        bytes[] memory foldSigs = new bytes[](0);

        vault.settleHands(GAME_ID, hands, signatures, folds, foldSigs);
    }
}
