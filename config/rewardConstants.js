/**
 * Reward Scheme Configuration
 * Thresholds and their corresponding benefit percentages.
 * The reward points are calculated as: amount * (percentage / 100)
 */
const REWARD_SCHEME = [
  { threshold: 40000, percentage: 25 },      // → 10,000 bonus, total 50,000
  { threshold: 30000, percentage: 25 },      // → 7,500 bonus, total 37,500
  { threshold: 20000, percentage: 20 },      // → 4,000 bonus, total 24,000
  { threshold: 10000, percentage: 15 },      // → 1,500 bonus, total 11,500
  { threshold: 7000, percentage: 14.2857 },  // → 1,000 bonus, total 8,000
  { threshold: 5000, percentage: 10 },       // → 500 bonus, total 5,500
  { threshold: 3000, percentage: 0 },        // → no bonus, total 3,000
];

module.exports = {
  REWARD_SCHEME,
};
