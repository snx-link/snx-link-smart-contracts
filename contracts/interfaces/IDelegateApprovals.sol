pragma solidity 0.4.25;


interface IDelegateApprovals {
    function canClaimFor(address authoriser, address delegate) external view returns (bool);
}
