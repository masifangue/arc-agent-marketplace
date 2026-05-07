// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockEURC
 * @notice Mock EURC token for testing purposes only.
 */
contract MockEURC is ERC20 {
    constructor() ERC20("Euro Coin", "EURC") {
        // Mint 1,000,000 EURC to deployer (6 decimals)
        _mint(msg.sender, 1_000_000 * 10 ** 6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint tokens to any address (for testing)
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
