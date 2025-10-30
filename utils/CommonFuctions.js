async function sanitize(input) {
    let sanitized = input.replace(/[^a-zA-Z0-9]/g, "_"); // Remove invalid characters
    sanitized = sanitized.replace(/\s+/g, "_"); // Replace spaces with underscores
    sanitized = sanitized.replace(/-/g, "_"); // Replace hyphens with underscores
    return sanitized.slice(0, 50); // Ensure max length of 50 characters
}

module.exports = { sanitize };
