pragma solidity ^0.4.0;

import "../interfaces/IFeePool.sol";

contract MockFeePool is IFeePool{

    mapping(address => bool) public feesClaimable;

    mapping(address => uint) public fees;
    mapping(address => uint) public rewards;

    bool public failClaim;

    function setFeesClaimable(address account, bool isClaimable) external {
        feesClaimable[account] = isClaimable;
    }

    function isFeesClaimable(address account) external view returns (bool) {
        return feesClaimable[account];
    }

    function setFeesAvailable(address account, uint fee, uint reward) external {
        fees[account] = fee;
        rewards[account] = reward;
    }

    function feesAvailable(address account) external view returns (uint, uint) {
        return (fees[account], rewards[account]);
    }

    function setFailClaim(bool _failClaim) external {
        failClaim = _failClaim;
    }

    function claimOnBehalf(address claimingForAddress) external returns (bool) {
        return !failClaim;
    }

}
