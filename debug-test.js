// Debug script to test VfxClient import
console.log('Testing VfxClient import...');

try {
  // Test named export
  const { VfxClient: NamedVfxClient } = require('vfx-web-sdk');
  console.log('Named export VfxClient:', typeof NamedVfxClient, NamedVfxClient);

  // Test default export
  const DefaultVfxClient = require('vfx-web-sdk').default;
  console.log('Default export VfxClient:', typeof DefaultVfxClient, DefaultVfxClient);

  // Test full module
  const fullModule = require('vfx-web-sdk');
  console.log('Full module:', Object.keys(fullModule));
  console.log('Full module default:', fullModule.default);

  // Test constructor
  if (typeof NamedVfxClient === 'function') {
    const instance = new NamedVfxClient('testnet');
    console.log('Named export constructor works:', typeof instance);
  }

  if (typeof DefaultVfxClient === 'function') {
    const instance = new DefaultVfxClient('testnet');
    console.log('Default export constructor works:', typeof instance);
  }

} catch (error) {
  console.error('Import test failed:', error);
}