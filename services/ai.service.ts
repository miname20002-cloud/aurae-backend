import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY, 
});

interface ChatRequest {
  userId: string;
  userMessage: string;
}

export const handleAuraeChat = async ({ userId, userMessage }: ChatRequest) => {
  try {
    const longTermMemory = "임시 데이터: 유저는 미국 진출을 준비하는 30대 창업자이며 매운 떡볶이를 좋아함."; 

    const systemInstruction = `
      You are 'Aurae', an elite, minimalist AI companion for Gen Z professionals.
      - Maintain a sophisticated, calm, and premium tone.
      - DO NOT give excessive emotional flattery or useless compliments. Focus on objective value and deep insights.
      - Here is the user's Long-term Memory you must remember: "${longTermMemory}"
    `;

    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemInstruction,
      messages: [{ role: "user", content: userMessage }],
    });

    return response.content[0].text;

  } catch (error) {
    console.error("Aurae AI Pipeline Error:", error);
    throw new Error("Aurae의 생각을 불러오는 중 일시적인 서버 지연이 발생했습니다.");
  }
};
