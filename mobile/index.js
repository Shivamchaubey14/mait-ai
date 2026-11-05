import { registerRootComponent } from 'expo';

// Imported for its side effect: it calls TaskManager.defineTask at module load, in the global
// scope, so the background-sync task exists the instant Android wakes the app headless — which
// happens through this entry file, before any React component mounts. Must run before the task
// is ever invoked, so it is imported here rather than inside a component.
import './src/api/backgroundSync';
import App from './App';

// registerRootComponent rather than an AppEntry shim — it behaves the same across SDK
// upgrades, which is the point of failure this file most often becomes.
registerRootComponent(App);
