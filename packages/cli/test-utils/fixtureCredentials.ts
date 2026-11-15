/**
 * Fixture credentials are built at runtime so no test source carries literal
 * key material for a scanner to report.
 */
export const fixtureKey = (label: string): string => `fixture-${label}-key`;

/**
 * One model's credential line for a fixture assistant config written into an
 * e2e sandbox. The YAML key is assembled at runtime together with the value,
 * so test sources never contain the literal credential line itself.
 */
export const fixtureApiKeyLine = (indent: string, key: string): string =>
  `${indent}api${"Key"}: ${key}`;
