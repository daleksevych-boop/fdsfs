import Anthropic from '@anthropic-ai/sdk';

export interface EmailAnalysisResult {
  summary: string;
  sentiment: string;
  keyPoints: string[];
  suggestedResponses: string[];
}

const SYSTEM_PROMPT = `Ти — професійний бізнес-асистент для аналізу електронних листів.
Твоя задача:
1. Проаналізувати лист і створити короткий звіт (2-3 речення).
2. Визначити тон/настрій листа (позитивний, нейтральний, негативний, терміновий).
3. Виділити ключові пункти листа (до 5 пунктів).
4. Запропонувати 3 варіанти відповіді різного стилю: формальний, дружній, короткий.

Відповідай ВИКЛЮЧНО у JSON-форматі без markdown-обгортки:
{
  "summary": "Короткий звіт по листу",
  "sentiment": "позитивний | нейтральний | негативний | терміновий",
  "keyPoints": ["пункт 1", "пункт 2"],
  "suggestedResponses": ["Формальна відповідь...", "Дружня відповідь...", "Коротка відповідь..."]
}`;

export async function analyzeEmail(emailText: string): Promise<EmailAnalysisResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn('⚠️ ANTHROPIC_API_KEY не знайдено, використовується локальний аналіз');
    return analyzeLocally(emailText);
  }

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: `Проаналізуй цей лист:\n\n${emailText}` }
      ]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const parsed: EmailAnalysisResult = JSON.parse(content.text);
    return parsed;
  } catch (error) {
    console.error('❌ Помилка Anthropic API:', error);
    return analyzeLocally(emailText);
  }
}

function analyzeLocally(emailText: string): EmailAnalysisResult {
  const text = emailText.toLowerCase();
  const wordCount = emailText.split(/\s+/).length;

  // Визначення настрою
  const urgentWords = ['терміново', 'негайно', 'asap', 'urgent', 'deadline', 'дедлайн'];
  const positiveWords = ['дякую', 'вдячний', 'чудово', 'відмінно', 'thank', 'great', 'excellent', 'happy', 'pleased'];
  const negativeWords = ['проблема', 'скарга', 'незадоволен', 'помилка', 'issue', 'problem', 'complaint', 'error', 'disappointed'];

  let sentiment = 'нейтральний';
  if (urgentWords.some(w => text.includes(w))) sentiment = 'терміновий';
  else if (positiveWords.some(w => text.includes(w))) sentiment = 'позитивний';
  else if (negativeWords.some(w => text.includes(w))) sentiment = 'негативний';

  // Виділення ключових пунктів (речення з ключовими словами)
  const sentences = emailText.split(/[.!?]\s+/).filter(s => s.trim().length > 10);
  const keyPoints = sentences.slice(0, 5).map(s => s.trim());

  // Короткий звіт
  const summary = `Лист містить ${wordCount} слів. Тон: ${sentiment}. ${
    sentences.length > 0 ? `Основна тема: ${sentences[0].substring(0, 80)}...` : 'Текст занадто короткий для детального аналізу.'
  }`;

  // Пропоновані відповіді
  const suggestedResponses = generateLocalResponses(sentiment, emailText);

  return { summary, sentiment, keyPoints, suggestedResponses };
}

function generateLocalResponses(sentiment: string, emailText: string): string[] {
  const senderMatch = emailText.match(/(?:від|from|dear|шановний|шановна)\s+([^\n,]+)/i);
  const senderName = senderMatch ? senderMatch[1].trim() : '';
  const greeting = senderName ? `Шановний(-а) ${senderName}` : 'Доброго дня';

  switch (sentiment) {
    case 'терміновий':
      return [
        `${greeting},\n\nДякую за ваш лист. Я ознайомився з терміновістю питання і вже працюю над його вирішенням. Очікуйте відповідь протягом найближчих годин.\n\nЗ повагою`,
        `${greeting},\n\nДякую, що звернулись! Розумію, що це терміново — вже займаюсь цим. Напишу, як буде готово!\n\nДякую за терпіння`,
        `${greeting},\n\nПрийнято. Працюю над цим.\n\nЗ повагою`
      ];
    case 'позитивний':
      return [
        `${greeting},\n\nДякую за ваш лист та позитивний відгук. Ми цінуємо вашу співпрацю та завжди раді допомогти. Якщо виникнуть додаткові питання, будь ласка, звертайтесь.\n\nЗ повагою`,
        `${greeting},\n\nДуже приємно отримати ваш лист! Дякую за теплі слова. Якщо знадобиться допомога — завжди на зв'язку!\n\nДо зустрічі`,
        `${greeting},\n\nДякую! Радий(-а) допомогти.\n\nЗ повагою`
      ];
    case 'негативний':
      return [
        `${greeting},\n\nДякую, що повідомили про цю ситуацію. Прошу вибачення за незручності. Ми вже аналізуємо проблему та вживаємо заходів для її вирішення. Я зв'яжусь з вами з оновленням.\n\nЗ повагою`,
        `${greeting},\n\nДякую за ваш зворотний зв'язок. Мені дуже шкода, що так сталося. Давайте разом знайдемо найкраще рішення — я вже працюю над цим!\n\nДякую за розуміння`,
        `${greeting},\n\nПрийняв(-ла) до відома. Працюємо над вирішенням.\n\nЗ повагою`
      ];
    default:
      return [
        `${greeting},\n\nДякую за ваш лист. Я ознайомився з його змістом та готую відповідь. Якщо потрібна додаткова інформація, будь ласка, повідомте.\n\nЗ повагою`,
        `${greeting},\n\nДякую, що написали! Я переглянув(-ла) ваш лист. Якщо є питання — пишіть, завжди на зв'язку!\n\nДо зв'язку`,
        `${greeting},\n\nДякую за лист. Прийнято.\n\nЗ повагою`
      ];
  }
}
