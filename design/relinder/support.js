<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body { margin: 0; }
  @keyframes breathe { 0%, 100% { opacity: .4; transform: scale(1); } 50% { opacity: 1; transform: scale(1.18); } }
  /* doradca w kanale odwraca głowę: od Ony (lewo) ku On (prawo) i z powrotem */
  /* puls na osobie, na którą doradca czeka — radiujący pierścień + lekkie powiększenie */
  @keyframes pulseWait {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(125,154,111,.45); }
    50% { transform: scale(1.12); box-shadow: 0 0 0 5px rgba(125,154,111,0); }
  }
</style>
</helmet>

<div style="min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 24px; background: #e9e4dc; font-family: 'Hanken Grotesk', sans-serif; color: #33302a; box-sizing: border-box;">

  <div style="width: min(720px, 100%); height: min(860px, calc(100dvh - 48px)); background: #f7f2ea; border-radius: 18px; box-shadow: 0 18px 50px -18px rgba(60,50,35,.32); overflow: hidden; display: flex; flex-direction: column;">

    <!-- header -->
    <header style="flex: none; padding: 16px 26px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #ebe1d2; background: #fdfbf7;">
      <div style="display:flex; align-items:center; gap:12px;">
        <span style="flex:none; display:inline-flex; align-items:center;"><span style="width:20px; height:20px; border-radius:50%; border:2px solid #c98a5e;"></span><span style="width:20px; height:20px; border-radius:50%; border:2px solid #7d9a6f; margin-left:-9px;"></span></span>
        <span style="display:flex; flex-direction:column; gap:4px;">
          <span style="font: 500 22px/1 'Newsreader'; color:#33302a;">Relinder</span>
          <span style="font: 600 9.5px 'Hanken Grotesk'; letter-spacing:.16em; text-transform:uppercase; color:#b0a488; white-space:nowrap;">support for your relationship · room for both voices</span>
        </span>
      </div>
      <div style="display: flex; align-items: center;" title="Doradca · Ona · On">
        <span style="position:relative; display:inline-block; width:34px; height:34px; border-radius:50%; overflow:hidden; background:#ece4d3; border:2.5px solid #fdfbf7; box-shadow:0 1px 4px rgba(80,60,35,.22);"><span style="position:absolute; left:50%; top:50%; width:54px; height:54px; transform:translate(-50%,-47%) scale(.63);"><span style="position:absolute; bottom:0; left:8px; width:38px; height:19px; border-radius:19px 19px 6px 6px; background:#9a8f76;"></span><span style="position:absolute; top:9px; left:17px; width:20px; height:20px; border-radius:50%; background:#9a8f76;"></span></span></span>
        <span style="position:relative; display:inline-block; width:34px; height:34px; border-radius:50%; overflow:hidden; background:#f0d6c2; border:2.5px solid #fdfbf7; box-shadow:0 1px 4px rgba(80,60,35,.22); margin-left:-10px;"><span style="position:absolute; left:50%; top:50%; width:54px; height:54px; transform:translate(-50%,-47%) scale(.63);"><img src="uploads/imageK.png" alt="Ona" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span>
        <span style="position:relative; display:inline-block; width:34px; height:34px; border-radius:50%; overflow:hidden; background:#d6e2cb; border:2.5px solid #fdfbf7; box-shadow:0 1px 4px rgba(80,60,35,.22); margin-left:-10px;"><span style="position:absolute; left:50%; top:50%; width:54px; height:54px; transform:translate(-50%,-47%) scale(.63);"><img src="uploads/imageM.png" alt="On" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span>
      </div>
    </header>

    <!-- phase ribbon -->
    <div style="flex: none; display: flex; align-items: center; gap: 14px; padding: 11px 26px; background: #faf6ef; border-bottom: 1px solid #efe6d6;">
      <span style="font: 600 10.5px 'Hanken Grotesk'; letter-spacing: .12em; text-transform: uppercase; color: #b0a285;">Faza</span>
      <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
        <div style="height: 5px; flex: 2.2; border-radius: 999px; background: linear-gradient(90deg, #c79a6a, #cba876);"></div>
        <span style="font: 600 11.5px 'Hanken Grotesk'; color: #9a7142; white-space: nowrap;">Otwarcie</span>
        <div style="height: 5px; flex: 1; border-radius: 999px; background: #e6dcc8;"></div>
        <div style="height: 5px; flex: 1; border-radius: 999px; background: #e6dcc8;"></div>
        <div style="height: 5px; flex: 1; border-radius: 999px; background: #e6dcc8;"></div>
        <div style="height: 5px; flex: 1; border-radius: 999px; background: #e6dcc8;"></div>
        <div style="height: 5px; flex: 1; border-radius: 999px; background: #e6dcc8;"></div>
      </div>
      <span style="font: 500 11px 'Hanken Grotesk'; color: #bdb29a; white-space: nowrap;">→ Sedno · Ustalenia</span>
    </div>

    <!-- messages with center channel -->
    <div style="flex: 1; position: relative; overflow: hidden;">
      <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 50%; background: rgba(201,138,94,.045);"></div>
      <div style="position: absolute; right: 0; top: 0; bottom: 0; width: 50%; background: rgba(125,154,111,.05);"></div>
      <div style="position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: linear-gradient(180deg, transparent, #e3d7c1 12%, #e3d7c1 88%, transparent); transform: translateX(-.5px);"></div>

      <div style="position: relative; height: 100%; padding: 24px 26px; display: flex; flex-direction: column; gap: 18px; overflow: hidden;">

        <!-- her, left bank -->
        <div style="align-self: flex-start; max-width: 46%;">
          <div style="margin: 0 2px 5px;"><span style="display:inline-block; vertical-align:middle; width:34px; height:34px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.63); transform-origin:top left;"><img src="uploads/imageK.png" alt="Ona" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span></div>
          <div style="background: linear-gradient(135deg, #f4ddcd, #f6e7df); color: #5a4434; padding: 13px 17px; border-radius: 4px 16px 16px 16px; font: 400 15.5px/1.5 'Hanken Grotesk'; box-shadow: 0 4px 14px -10px rgba(150,90,50,.45);">On nigdy mnie nie słucha..</div>
        </div>

        <!-- advisor: turns LEFT toward Ona (pogłębienie u niej) -->
        <div style="align-self: flex-start; width: 49%; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
          <span style="display:inline-block; width:34px; height:34px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.63); transform-origin:top left;"><span style="position:absolute; bottom:0; left:8px; width:38px; height:19px; border-radius:19px 19px 6px 6px; background:#9a8f76;"></span><span style="position:absolute; top:9px; left:17px; width:20px; height:20px; border-radius:50%; background:#9a8f76;"></span></span></span>
          <div style="background: #fff; border-radius: 16px; padding: 15px 19px; box-shadow: 0 6px 18px -10px rgba(80,60,35,.28); font: 400 16.5px/1.6 'Newsreader'; color: #3a352c; text-align: center; text-wrap: pretty;">Słyszę, że czujesz się nieusłyszana — to bolesne. Co czujesz w takim momencie najmocniej?</div>
        </div>

        <!-- him, right bank -->
        <div style="align-self: flex-end; max-width: 46%; text-align: right;">
          <div style="display:flex; justify-content:flex-end; margin: 0 2px 5px;"><span style="display:inline-block; vertical-align:middle; width:34px; height:34px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.63); transform-origin:top left;"><img src="uploads/imageM.png" alt="On" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span></div>
          <div style="background: linear-gradient(135deg, #dde7d4, #e8eee3); color: #3e4b37; padding: 13px 17px; border-radius: 16px 4px 16px 16px; font: 400 15.5px/1.5 'Hanken Grotesk'; box-shadow: 0 4px 14px -10px rgba(70,100,55,.4); text-align: left;">Przecież słucham</div>
        </div>

        <!-- advisor 2: turns RIGHT toward On (czeka na niego) — animowany zwrot -->
        <div style="align-self: flex-end; width: 49%; display: flex; flex-direction: column; align-items: flex-start; gap: 6px;">
          <span style="display:inline-block; width:34px; height:34px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.63); transform-origin:top left;"><span style="position:absolute; bottom:0; left:8px; width:38px; height:19px; border-radius:19px 19px 6px 6px; background:#9a8f76;"></span><span style="position:absolute; top:9px; left:17px; width:20px; height:20px; border-radius:50%; background:#9a8f76;"></span></span></span>
          <div style="position: relative; background: #fff; border-radius: 16px; padding: 15px 19px; box-shadow: 0 6px 18px -10px rgba(80,60,35,.28); font: 400 16.5px/1.6 'Newsreader'; color: #3a352c; text-align: center; text-wrap: pretty;">
            Słyszę dwie potrzeby naraz — i to nie są sprzeczne rzeczy.
          </div>
        </div>

      </div>
    </div>

    <!-- presence -->
    <div style="flex: none; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 9px 14px; background: #f3ece0; color: #8a6f50; font: 500 12.5px 'Hanken Grotesk'; font-style: italic; border-top: 1px solid #efe6d6;">
      <span style="display:inline-block; vertical-align:middle; width:20px; height:20px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.37); transform-origin:top left;"><span style="position:absolute; bottom:0; left:8px; width:38px; height:19px; border-radius:19px 19px 6px 6px; background:#9a8f76;"></span><span style="position:absolute; top:9px; left:17px; width:20px; height:20px; border-radius:50%; background:#9a8f76;"></span></span></span>
      <span>czeka na odpowiedź:</span>
      <span style="display:inline-block; vertical-align:middle; width:20px; height:20px; border-radius:50%; animation: pulseWait 1.6s infinite ease-in-out;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.37); transform-origin:top left;"><img src="uploads/imageM.png" alt="On" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span>
    </div>

    <!-- composer -->
    <div style="flex: none; padding: 14px 20px 18px; border-top: 1px solid #ebe1d2; background: #fdfbf7; display: flex; align-items: center; gap: 12px;">
      <div style="display: flex; background: #efe7da; border-radius: 999px; padding: 3px;">
        <span style="display:flex; align-items:center; gap:6px; padding: 7px 12px; border-radius: 999px; font: 500 12.5px 'Hanken Grotesk'; color: #8a8170;"><span style="display:inline-block; width:18px; height:18px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.333); transform-origin:top left;"><img src="uploads/imageK.png" alt="Ona" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span>Ona</span>
        <span style="display:flex; align-items:center; gap:6px; padding: 7px 12px; border-radius: 999px; background: #fff; color: #5e7551; font: 600 12.5px 'Hanken Grotesk'; box-shadow: 0 1px 3px rgba(70,100,55,.18);"><span style="display:inline-block; width:18px; height:18px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.333); transform-origin:top left;"><img src="uploads/imageM.png" alt="On" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span>On</span>
        <span style="display:flex; align-items:center; gap:6px; padding: 7px 12px; border-radius: 999px; font: 500 12.5px 'Hanken Grotesk'; color: #8a8170;"><span style="display:inline-flex; align-items:flex-end;"><span style="position:relative; z-index:1; display:inline-block; width:18px; height:18px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.333); transform-origin:top left;"><img src="uploads/imageK.png" alt="Ona" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span><span style="display:inline-block; width:18px; height:18px; margin-left:-5px;"><span style="position:relative; display:block; width:54px; height:54px; transform:scale(.333); transform-origin:top left;"><img src="uploads/imageM.png" alt="On" style="display:block; width:54px; height:54px; border-radius:50%; object-fit:cover;"></span></span></span>Razem</span>
      </div>
      <div style="flex: 1; display: flex; align-items: center; gap: 10px; background: #fff; border-radius: 14px; padding: 8px 8px 8px 16px; box-shadow: inset 0 0 0 1.5px rgba(125,154,111,.4);">
        <span style="flex: 1; font: 400 15px 'Hanken Grotesk'; color: #b3aa98;">Twoja kolej — co wtedy się stało?</span>
        <span style="flex: none; width: 38px; height: 38px; border-radius: 11px; background: linear-gradient(135deg, #7d9a6f, #c98a5e); color: #fff; font-size: 18px; display: flex; align-items: center; justify-content: center;">↑</span>
      </div>
    </div>

  </div>
</div>
</x-dc>
</body>
</html>
