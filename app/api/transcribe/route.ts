import { NextResponse } from 'next/server';
// import OpenAI from 'openai';

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

export async function POST(request: Request) {
  console.log("Transcription service: Received POST request.");
  try {
    console.log("Transcription service: Starting transcription process.");
    
    // const formData = await request.formData();
    // const audioFile = formData.get('audio');
    
    // if (!(audioFile instanceof Blob)) {
    //   console.error("Transcription service: Invalid audio format received.");
    //   return NextResponse.json(
    //     { error: 'Invalid audio format' },
    //     { status: 400 }
    //   );
    // }

    // const file = new File([audioFile], 'recording.webm', {
    //   type: 'audio/webm',
    // });

    // const transcription = await openai.audio.transcriptions.create({
    //   file: file,
    //   model: "whisper-1",
    //   response_format: "text",
    // });
    const transcription = "mock transcript";
    console.log("Transcription service: Transcription completed successfully:", transcription);
    
    return NextResponse.json({ text: transcription });
  } catch (error) {
    console.error('Transcription service: Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
}