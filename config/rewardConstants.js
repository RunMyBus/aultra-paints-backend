/**
 * Reward Scheme Configuration
 * Thresholds and their corresponding benefit percentages.
 * The reward points are calculated as: amount * (percentage / 100)
 */
const REWARD_SCHEME = [
  { threshold: 40000, percentage: 37.5 },
  { threshold: 30000, percentage: 26.67 },
  { threshold: 20000, percentage: 30 },
  { threshold: 10000, percentage: 25 },
  { threshold: 7000, percentage: 21.43 },
  { threshold: 5000, percentage: 15 },
  { threshold: 3000, percentage: 10 },
];

module.exports = {
  REWARD_SCHEME,
};
