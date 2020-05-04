pragma solidity 0.4.25;


interface ISynthetix {
    /**
     * @notice Delegated burnSynthsToTarget(). Call from the delegated address to burn synths on behalf of the user.
     * approveBurnOnBehalf() must be called first to approve the delegate address
     * @param burnForAddress The account you are claiming fees for
     */
    function burnSynthsToTargetOnBehalf(address burnForAddress) external;

    /**
     * @notice The current collateralisation ratio for a user. Collateralisation ratio varies over time
     * as the value of the underlying Synthetix asset changes,
     * e.g. based on an issuance ratio of 20%. if a user issues their maximum available
     * synths when they hold $10 worth of Synthetix, they will have issued $2 worth of synths. If the value
     * of Synthetix changes, the ratio returned by this function will adjust accordingly. Users are
     * incentivised to maintain a collateralisation ratio as close to the issuance ratio as possible by
     * altering the amount of fees they're able to claim from the system.
     */
    function collateralisationRatio(address _issuer) public view returns (uint);
}
