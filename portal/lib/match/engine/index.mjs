// ESM entry. The engine itself is a dependency-free CommonJS/browser-global file.
import RME from './rupert-match-engine.cjs';
export default RME;
export const { normalize, run, preview, rulesText, roleOf, defaultTypes, bucketsFor,
  VC_LADDER, PE_STAGES, INDUSTRIES, VERTICALS, V2I, US_REGIONS, COUNTRIES, STATE_REGION, LEVELS, TUNE, ROLE_LABEL, SITE_LABEL } = RME;
