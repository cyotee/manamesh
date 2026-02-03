// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console2 } from "forge-std/Test.sol";
import { ChipToken } from "../src/ChipToken.sol";
import { IChipToken } from "../src/interfaces/IChipToken.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ChipTokenTest is Test {
    ChipToken public chips;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public owner;

    function setUp() public {
        chips = new ChipToken();
        owner = address(this);

        // Fund test accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    // =============================================================
    //                         DEPOSIT TESTS
    // =============================================================

    function test_deposit_mintsChipsEqualToEth() public {
        uint256 depositAmount = 1 ether;

        vm.prank(alice);
        chips.deposit{ value: depositAmount }();

        assertEq(chips.balanceOf(alice), depositAmount);
        assertEq(chips.ethReserve(), depositAmount);
    }

    function test_deposit_emitsEvent() public {
        uint256 depositAmount = 5 ether;

        vm.expectEmit(true, false, false, true);
        emit IChipToken.Deposited(alice, depositAmount, depositAmount);

        vm.prank(alice);
        chips.deposit{ value: depositAmount }();
    }

    function test_deposit_revertsOnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IChipToken.ZeroDeposit.selector);
        chips.deposit{ value: 0 }();
    }

    function test_deposit_multipleDeposits() public {
        vm.prank(alice);
        chips.deposit{ value: 1 ether }();

        vm.prank(alice);
        chips.deposit{ value: 2 ether }();

        assertEq(chips.balanceOf(alice), 3 ether);
        assertEq(chips.ethReserve(), 3 ether);
    }

    // =============================================================
    //                       WITHDRAW TESTS
    // =============================================================

    function test_withdraw_returnsEthAndBurnsChips() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        chips.withdraw(3 ether);

        assertEq(chips.balanceOf(alice), 7 ether);
        assertEq(alice.balance, aliceBalanceBefore + 3 ether);
        assertEq(chips.ethReserve(), 7 ether);
    }

    function test_withdraw_emitsEvent() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        vm.expectEmit(true, false, false, true);
        emit IChipToken.Withdrawn(alice, 5 ether, 5 ether);

        vm.prank(alice);
        chips.withdraw(5 ether);
    }

    function test_withdraw_revertsOnZeroAmount() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        vm.prank(alice);
        vm.expectRevert(IChipToken.ZeroWithdraw.selector);
        chips.withdraw(0);
    }

    function test_withdraw_revertsOnInsufficientBalance() public {
        vm.prank(alice);
        chips.deposit{ value: 5 ether }();

        vm.prank(alice);
        vm.expectRevert(IChipToken.InsufficientBalance.selector);
        chips.withdraw(10 ether);
    }

    function test_withdraw_fullBalance() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        chips.withdraw(10 ether);

        assertEq(chips.balanceOf(alice), 0);
        assertEq(alice.balance, aliceBalanceBefore + 10 ether);
    }

    // =============================================================
    //                       ERC-20 TESTS
    // =============================================================

    function test_transfer_works() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        vm.prank(alice);
        chips.transfer(bob, 3 ether);

        assertEq(chips.balanceOf(alice), 7 ether);
        assertEq(chips.balanceOf(bob), 3 ether);
    }

    function test_approve_and_transferFrom() public {
        vm.prank(alice);
        chips.deposit{ value: 10 ether }();

        vm.prank(alice);
        chips.approve(bob, 5 ether);

        vm.prank(bob);
        chips.transferFrom(alice, bob, 5 ether);

        assertEq(chips.balanceOf(alice), 5 ether);
        assertEq(chips.balanceOf(bob), 5 ether);
    }

    // =============================================================
    //                       PERMIT TESTS
    // =============================================================

    function test_permit_setsAllowance() public {
        uint256 privateKey = 0xA11CE;
        address signer = vm.addr(privateKey);

        // Fund the signer account first
        vm.deal(signer, 20 ether);

        vm.prank(signer);
        chips.deposit{ value: 10 ether }();

        bytes32 PERMIT_TYPEHASH = keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = chips.nonces(signer);

        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, signer, bob, 5 ether, nonce, deadline));

        bytes32 domainSeparator = chips.DOMAIN_SEPARATOR();
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        chips.permit(signer, bob, 5 ether, deadline, v, r, s);

        assertEq(chips.allowance(signer, bob), 5 ether);
    }

    // =============================================================
    //                       RECEIVE TESTS
    // =============================================================

    function test_receive_acceptsEth() public {
        // The receive() function allows ETH to be sent directly
        (bool success,) = address(chips).call{ value: 1 ether }("");
        assertTrue(success);
        assertEq(address(chips).balance, 1 ether);
    }

    // =============================================================
    //                        FUZZ TESTS
    // =============================================================

    function testFuzz_depositAndWithdraw(uint256 amount) public {
        amount = bound(amount, 1, 50 ether); // Keep reasonable bounds

        vm.prank(alice);
        chips.deposit{ value: amount }();

        assertEq(chips.balanceOf(alice), amount);

        uint256 aliceBalanceBefore = alice.balance;

        vm.prank(alice);
        chips.withdraw(amount);

        assertEq(chips.balanceOf(alice), 0);
        assertEq(alice.balance, aliceBalanceBefore + amount);
    }
}
