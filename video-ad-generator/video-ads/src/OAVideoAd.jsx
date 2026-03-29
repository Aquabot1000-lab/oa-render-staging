import React from 'react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring, Sequence} from 'remotion';

const BRAND = {
  purple: '#6c5ce7',
  blue: '#0984e3',
  dark: '#1a1a2e',
  white: '#ffffff',
};

export const OAVideoAd = ({headline, subtext, cta = 'Get Your Free Analysis', url = 'overassessed.ai'}) => {
  const frame = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();

  // Animations
  const bgScale = interpolate(frame, [0, 30], [1.1, 1], {extrapolateRight: 'clamp'});
  const headlineY = spring({frame, fps, from: 60, to: 0, config: {damping: 12}});
  const headlineOpacity = interpolate(frame, [0, 15], [0, 1], {extrapolateRight: 'clamp'});
  const subOpacity = interpolate(frame, [20, 40], [0, 1], {extrapolateRight: 'clamp'});
  const subY = spring({frame: Math.max(0, frame - 15), fps, from: 40, to: 0, config: {damping: 12}});
  const ctaScale = spring({frame: Math.max(0, frame - 40), fps, from: 0.5, to: 1, config: {damping: 10}});
  const ctaOpacity = interpolate(frame, [40, 55], [0, 1], {extrapolateRight: 'clamp'});
  const urlOpacity = interpolate(frame, [55, 70], [0, 1], {extrapolateRight: 'clamp'});

  // Subtle pulse on CTA
  const ctaPulse = frame > 70 ? 1 + 0.02 * Math.sin((frame - 70) * 0.15) : 1;

  return (
    <AbsoluteFill style={{backgroundColor: BRAND.dark}}>
      {/* Animated gradient background */}
      <AbsoluteFill style={{
        background: `linear-gradient(135deg, ${BRAND.purple}, ${BRAND.blue})`,
        transform: `scale(${bgScale})`,
      }} />

      {/* Subtle animated particles/glow */}
      <AbsoluteFill style={{
        background: `radial-gradient(circle at ${30 + frame * 0.3}% ${40 + Math.sin(frame * 0.05) * 10}%, rgba(255,255,255,0.1) 0%, transparent 50%)`,
      }} />

      {/* Content container */}
      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 100,
        textAlign: 'center',
      }}>
        {/* Headline */}
        <div style={{
          fontSize: 52,
          fontWeight: 900,
          color: BRAND.white,
          lineHeight: 1.2,
          marginBottom: 32,
          transform: `translateY(${headlineY}px)`,
          opacity: headlineOpacity,
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
          textShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}>
          {headline}
        </div>

        {/* Subtext */}
        <div style={{
          fontSize: 26,
          color: 'rgba(255,255,255,0.9)',
          lineHeight: 1.5,
          marginBottom: 50,
          maxWidth: 780,
          transform: `translateY(${subY}px)`,
          opacity: subOpacity,
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}>
          {subtext}
        </div>

        {/* CTA Button */}
        <div style={{
          background: BRAND.white,
          color: BRAND.purple,
          fontSize: 30,
          fontWeight: 800,
          padding: '22px 50px',
          borderRadius: 50,
          boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
          transform: `scale(${ctaScale * ctaPulse})`,
          opacity: ctaOpacity,
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}>
          {cta}
        </div>

        {/* URL */}
        <div style={{
          marginTop: 32,
          fontSize: 22,
          color: 'rgba(255,255,255,0.8)',
          opacity: urlOpacity,
          fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif',
        }}>
          {url} | No Win, No Fee
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
