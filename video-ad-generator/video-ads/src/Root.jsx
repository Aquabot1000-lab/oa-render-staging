import React from 'react';
import {Composition} from 'remotion';
import {OAVideoAd} from './OAVideoAd';

const ANGLES = [
  {headline: "Your Property Taxes Are Too High", subtext: "The average homeowner saves $1,200+ per year with a successful protest."},
  {headline: "Stop Overpaying Property Taxes", subtext: "Most homeowners don't realize they're paying too much. We find the errors they miss."},
  {headline: "No Savings, No Fee", subtext: "We only get paid if we save you money. Zero risk, zero upfront cost."},
  {headline: "Save $1,200+ Per Year", subtext: "The average successful protest saves homeowners over a thousand dollars annually."},
  {headline: "Texas Homeowners: You're Overpaying", subtext: "TX property taxes are among the highest in the nation. Fight back."},
  {headline: "Georgia Property Tax Protest", subtext: "One successful appeal freezes your value for 3 years. Triple savings."},
  {headline: "Did Your Assessment Go Up?", subtext: "You don't have to accept it. Protest and save."},
  {headline: "Free Property Tax Analysis", subtext: "Find out in 24 hours if you're overpaying. No obligation."},
];

export const RemotionRoot = () => {
  return (
    <>
      {ANGLES.map((angle, i) => (
        <Composition
          key={`ad-${i + 1}`}
          id={`OA-Ad-${String(i + 1).padStart(2, '0')}`}
          component={OAVideoAd}
          durationInFrames={150}
          fps={30}
          width={1080}
          height={1080}
          defaultProps={angle}
        />
      ))}
    </>
  );
};
