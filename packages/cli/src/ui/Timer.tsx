import { Text } from "ink";
import React, { useEffect, useState } from "react";

import { formatDuration } from "./utils/formatDuration.js";

interface TimerProps {
  startTime: number;
  color?: string;
}

const Timer: React.FC<TimerProps> = ({ startTime, color = "dim" }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      setElapsed(elapsedSeconds);
    }, 1000); // Update every 1000ms for efficient display

    return () => clearInterval(interval);
  }, [startTime]);

  return <Text color={color}>{formatDuration(elapsed * 1000)}</Text>;
};

export { Timer };
