import { useState } from 'react';

/**
 * Awatar uczestnika rozmowy (design „Relvia").
 *  - HER / HIM → zdjęcie (web/public/avatars/ona.png · on.png),
 *  - ADVISOR   → neutralna sylwetka (doradca nie ma twarzy — jest „głosem między brzegami"),
 *  - fallback  → sylwetka w kolorze strony, gdy zdjęcie się nie wczyta.
 *
 * Komponent prezentacyjny i „głupi": kolor/rozmiar sterowane propsami, zero logiki rozmowy.
 */

export type AvatarWho = 'HER' | 'HIM' | 'ADVISOR';

interface Props {
  who: AvatarWho;
  size?: number; // średnica w px (domyślnie 34)
  pulse?: boolean; // pierścień „czekamy na tę osobę" (@keyframes pulseWait)
  alt?: string;
  className?: string;
}

// Zdjęcia leżą w web/public/avatars → serwowane spod /avatars/*.png
const PHOTO: Partial<Record<AvatarWho, string>> = {
  HER: '/avatars/ona.png',
  HIM: '/avatars/on.png',
};

// Kolor sylwetki wg strony (tokeny ze styles.css: terakota / szałwia / beż doradcy).
const SILHOUETTE_COLOR: Record<AvatarWho, string> = {
  HER: '#cf9266',
  HIM: '#7d9a6f',
  ADVISOR: '#9a8f76',
};

/** Prosta sylwetka (głowa + ramiona) w jednym kolorze — bez zależności od assetów. */
function Silhouette({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 54 54" width="100%" height="100%" aria-hidden="true" focusable="false">
      <circle cx="27" cy="20" r="11" fill={color} />
      <path d="M8 54c0-11 8.5-18 19-18s19 7 19 18z" fill={color} />
    </svg>
  );
}

export default function Avatar({ who, size = 34, pulse = false, alt, className }: Props) {
  const [broken, setBroken] = useState(false);
  const photo = PHOTO[who];
  const showPhoto = photo && !broken;

  return (
    <span
      className={`av av-${who.toLowerCase()}${pulse ? ' av-pulse' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      {showPhoto ? (
        <img src={photo} alt={alt ?? ''} className="av-img" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="av-sil" style={{ background: who === 'ADVISOR' ? '#ece4d3' : undefined }}>
          <Silhouette color={SILHOUETTE_COLOR[who]} />
        </span>
      )}
    </span>
  );
}
