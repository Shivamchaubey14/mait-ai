/**
 * Ambient type references.
 *
 * The React Native Testing Library matchers (toBeDisabled, toBeVisible, ...) are registered
 * at runtime in jest.setup.js. This tells TypeScript about them too, so a typo in a matcher
 * name is a compile error rather than a runtime one.
 */

/// <reference types="@testing-library/react-native/extend-expect" />
