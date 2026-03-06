export const TooltipStyles = () => (
  <style jsx global>{`
    .tooltip {
      position: relative;
    }

    .tooltip .tooltiptext {
      visibility: hidden;
      background-color: rgba(0, 0, 0, 0.8);
      color: #fff;
      text-align: center;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 0.75rem;
      white-space: nowrap;
      position: absolute;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.2s, visibility 0.2s;
    }

    .tooltip:hover .tooltiptext {
      visibility: visible;
      opacity: 1;
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
