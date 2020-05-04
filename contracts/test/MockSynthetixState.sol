pragma solidity 0.4.25;

import "../interfaces/ISynthetixState.sol";


contract MockSynthetixState is ISynthetixState {
    uint private systemIssuanceRatio;

    function setIssuanceRatio(uint _issuanceRatio) public {
        systemIssuanceRatio = _issuanceRatio;
    }

    function issuanceRatio() public view returns (uint) {
        return systemIssuanceRatio;
    }
}
