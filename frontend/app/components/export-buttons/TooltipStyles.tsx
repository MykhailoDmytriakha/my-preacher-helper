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
      white-space: nowrap;
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

    .tooltiptext-top {
      bottom: calc(100% + 5px);
      left: 50%;
      transform: translateX(-50%);
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
      left: 50%;
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
