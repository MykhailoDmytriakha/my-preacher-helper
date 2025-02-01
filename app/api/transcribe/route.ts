import { NextResponse } from 'next/server';
// import OpenAI from 'openai';

// const openai = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

export async function POST(request: Request) {
  try {
    // const formData = await request.formData();
    // const audioFile = formData.get('audio');
    
    // if (!(audioFile instanceof Blob)) {
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
    const transcription = "mock transcript"
    
    return NextResponse.json({ text: transcription });
  } catch (error) {
    console.error('Transcription error:', error);
    return NextResponse.json(
      { error: 'Failed to transcribe audio' },
      { status: 500 }
    );
  }
} 