import { buildTables } from './geodesics.js';
try {
  const { paths, endings } = buildTables(value => self.postMessage({ progress: value }));
  self.postMessage({ paths, endings }, [paths.buffer, endings.buffer]);
} catch (error) { self.postMessage({ error: error.message }); }
