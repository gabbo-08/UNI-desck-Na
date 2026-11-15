function isStrongCredentialKey(value) {
  return /^[0-9a-fA-F]{64}$/.test(String(value || ''))
    && new Set(String(value).toLowerCase()).size >= 8
    && !/^([0-9a-fA-F])\1+$/.test(String(value));
}

module.exports = { isStrongCredentialKey };
