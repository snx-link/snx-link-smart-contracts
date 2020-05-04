pragma solidity >=0.4.24;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

import "openzeppelin-solidity/contracts/utils/ReentrancyGuard.sol";


contract Withdrawable is Ownable, ReentrancyGuard {
    using SafeERC20 for ERC20;
    address public constant ETHER = address(0);

    event LogWithdrawAsset(address indexed _from, address indexed _asset, uint amount);

    /**
     * @dev Withdraw asset.
     * @param _assetAddress Asset to be withdrawn.
     * @return bool.
     */
    function withdrawAsset(address _assetAddress) public nonReentrant onlyOwner {
        uint assetBalance;
        if (_assetAddress == ETHER) {
            address self = address(this); // workaround for a possible solidity bug
            assetBalance = self.balance;
            require(msg.sender.call.value(assetBalance)(""), "Transfer failed");
        } else {
            assetBalance = ERC20(_assetAddress).balanceOf(address(this));
            ERC20(_assetAddress).safeTransfer(msg.sender, assetBalance);
        }
        emit LogWithdrawAsset(msg.sender, _assetAddress, assetBalance);
    }
}
