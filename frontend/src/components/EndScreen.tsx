type Props = {
  onRestart: () => void;
};

export default function EndScreen({ onRestart }: Props) {
  return (
    <div className="end-screen">
      <div className="end-inner">
        <span className="end-kicker">THE RAIN IS OVER</span>
        <h2>天快晴了。</h2>
        <p>
          Mira 把相机背好，推门走进午后的光里。
          <br />
          椅子还留着一点温度。
        </p>
        <button type="button" className="enter-button" onClick={onRestart}>
          <span>再坐一会儿</span>
          <span className="enter-arrow">↺</span>
        </button>
      </div>
    </div>
  );
}
