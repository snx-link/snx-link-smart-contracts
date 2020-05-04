pragma solidity 0.4.25;

import "../interfaces/ISynthetix.sol";


contract MockSynthetix is ISynthetix {
    mapping(address => bool) public accountCanBurn;

    mapping(address => uint) public userCollateralisationRatio;

    uint public burned;

    function burnSynthsToTargetOnBehalf(address burnForAddress) external {
        require(accountCanBurn[burnForAddress]);

        burned++;
    }

    function setAccountCanBurn(address account, bool _canBurn) external {
        accountCanBurn[account] = _canBurn;
    }

    function setCollateralisationRatio(address _issuer, uint _collateralisationRatio) public {
        userCollateralisationRatio[_issuer] = _collateralisationRatio;
    }

    function collateralisationRatio(address _issuer) public view returns (uint) {
        return userCollateralisationRatio[_issuer];
    }
}
