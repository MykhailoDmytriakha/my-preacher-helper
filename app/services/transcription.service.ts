const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000";
export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  console.log("transcribeAudio: Starting transcription process.");
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  console.log(
    `transcribeAudio: Sending audio blob to ${API_BASE}/api/transcribe.`
  );
  const response = await fetch(`${API_BASE}/api/transcribe`, {
    method: "POST",
    body: formData
  });

  console.log("transcribeAudio: Received response:", response);
  if (!response.ok) {
    console.error(
      "transcribeAudio: Transcription failed with status",
      response.status
    );
    throw new Error("Transcription failed");
  }

  const { text } = await response.json();
  console.log("transcribeAudio: Transcription succeeded. Text:", text);
  return text;
};
