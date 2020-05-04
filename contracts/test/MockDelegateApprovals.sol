pragma solidity 0.4.25;

import "../interfaces/IDelegateApprovals.sol";


contract MockDelegateApprovals is IDelegateApprovals {
    mapping(address => mapping(address => bool)) public approvals;
    mapping(address => mapping(address => bool)) public approvalsBurn;

    function canClaimFor(address authoriser, address delegate) external view returns (bool) {
        return approvals[authoriser][delegate];
    }

    function canBurnFor(address authoriser, address delegate) external view returns (bool) {
        return approvalsBurn[authoriser][delegate];
    }

    function setApproval(
        address authoriser,
        address delegate,
        bool approval
    ) external {
        approvals[authoriser][delegate] = approval;
    }

    function setApprovalBurn(
        address authoriser,
        address delegate,
        bool approval
    ) external {
        approvalsBurn[authoriser][delegate] = approval;
    }
}
