// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Counter
/// @notice Placeholder contract to verify Foundry setup
contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }
}
