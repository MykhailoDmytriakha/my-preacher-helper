export const TooltipStyles = () => (
  <style jsx global>{`
    .tooltip {
      position: relative;
    }

    /* Hidden, a tooltip is not laid out at all: a visibility-hidden box still widened a phone page
       (BUG-20261003-sermon-list-hidden-tooltips-scroll-sideways). */
    .tooltip .tooltiptext {
      display: none;
      background-color: rgba(0, 0, 0, 0.8);
      color: #fff;
      text-align: center;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.75rem;
      /* One line while it fits; a long reason wraps instead of leaving the window. */
      width: max-content;
      max-width: calc(100vw - 24px); /* the shared edge padding (utils/tooltipPlacement.ts) on both sides */
      white-space: normal;
      position: absolute;
      z-index: 1000;
    }

    .tooltip:hover .tooltiptext {
      display: block;
      animation: tooltip-fade-in 0.2s;
    }

    @keyframes tooltip-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* --tooltip-shift: set on hover by keepTooltipOnScreen so a tooltip by the window's edge stays inside it. */
    .tooltiptext-top {
      bottom: calc(100% + 5px);
      left: 50%;
      transform: translateX(calc(-50% + var(--tooltip-shift, 0px)));
    }

    .tooltiptext-right {
      left: calc(100% + 5px);
      top: 50%;
      transform: translateY(-50%);
    }

    .tooltiptext-top:after {
      content: "";
      position: absolute;
      top: 100%;
      left: calc(50% - var(--tooltip-shift, 0px));
      margin-left: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: rgba(0, 0, 0, 0.8) transparent transparent transparent;
    }

    .tooltiptext-right:after {
      content: "";
      position: absolute;
      top: 50%;
      right: 100%;
      margin-top: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: transparent rgba(0, 0, 0, 0.8) transparent transparent;
    }
  `}</style>
);
