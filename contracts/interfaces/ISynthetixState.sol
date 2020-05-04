pragma solidity 0.4.25;


interface ISynthetixState {
    // A quantity of synths greater than this ratio
    // may not be issued against a given value of SNX.
    function issuanceRatio() public view returns (uint);
}
