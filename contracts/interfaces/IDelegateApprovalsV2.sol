pragma solidity 0.4.25;


interface IDelegateApprovalsV2 {
    function canBurnFor(address authoriser, address delegate) external view returns (bool);

    function canClaimFor(address authoriser, address delegate) external view returns (bool);
}
