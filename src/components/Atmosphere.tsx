import { memo } from 'react';
const Atmosphere = memo(function Atmosphere() {
  return (
    <div className="atmo" aria-hidden>
      <div className="rays" /><div className="rays r2" />
      <div className="cloud c1" /><div className="cloud c2" /><div className="cloud c3" />
      <div className="sweep" /><div className="flare" />
    </div>
  );
});
export default Atmosphere;
