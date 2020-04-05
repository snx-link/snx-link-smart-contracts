pragma solidity 0.4.25;

interface IFeePool {
    /**
     * @notice Check if a particular address is able to claim fees right now
     * @param account The address you want to query for
     */
    function isFeesClaimable(address account) external view returns (bool);

    /**
     * @notice The fees available to be withdrawn by a specific account, priced in sUSD
     * @dev Returns two amounts, one for fees and one for SNX rewards
     */
    function feesAvailable(address account) external view returns (uint, uint);

    /**
     * @notice Delegated claimFees(). Call from the delegated address
     * and the fees will be sent to the claimingForAddress.
     * approveClaimOnBehalf() must be called first to approve the delegate address
     * @param claimingForAddress The account you are claiming fees for
     */
    function claimOnBehalf(address claimingForAddress) external returns (bool);
}
