import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Server as SocketServer, Socket } from 'socket.io';
import http from 'http';
import path from 'path';
import axios from 'axios';

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

const publicPath = path.resolve(__dirname, '../public');
app.use(express.static(publicPath));
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ===== ANALYTICS ENGINE =====

interface CityData {
  date: string;
  cityName: string;
  revenue: number;
  checks: number;
  avgCheckValue: number;
  delivery: number;
  dayOfWeek?: number;
}

// ПАРСИНГ ДАНИХ З GOOGLE SHEETS
async function getGoogleSheetsData(): Promise<CityData[]> {
  try {
    const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) {
      console.warn('⚠️ Google API Key не знайдено');
      return getMockData();
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/IDD!A1:E1000?key=${API_KEY}`;
    const response = await axios.get(url);

    const rows: string[][] = response.data.values || [];
    
    if (rows.length < 2) {
      console.warn('⚠️ Таблиця пуста');
      return getMockData();
    }

    const cityNames: string[] = [];
    for (let i = 1; i < rows[0].length; i++) {
      if (rows[0][i] && rows[0][i].trim()) {
        cityNames.push(rows[0][i].trim());
      }
    }

    console.log('🏙️ Міста в таблиці:', cityNames);

    const allData: CityData[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0]) continue;

      const date = row[0].trim();
      const dateParts = date.split('.');
      const dateObj = new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]));
      const dayOfWeek = dateObj.getDay();

      for (let j = 1; j < row.length && j <= cityNames.length; j++) {
        const cellValue = row[j]?.trim() || '';
        if (!cellValue || cellValue === '0 / 0 / 0') continue;

        const parts = cellValue.split('/').map(p => {
          const cleaned = p.trim().replace(/[^\d.]/g, '');
          return parseFloat(cleaned) || 0;
        });

        if (parts[0] > 0 || parts[1] > 0) {
          allData.push({
            date: date,
            cityName: cityNames[j - 1],
            revenue: parts[0] || 0,
            checks: parts[1] || 0,
            avgCheckValue: parts[2] || 0,
            delivery: parts[3] || 0,
            dayOfWeek: dayOfWeek
          });

          console.log(`✅ ${date} (${['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dayOfWeek]}) | ${cityNames[j - 1]} | ${parts[0]}€`);
        }
      }
    }

    console.log(`📊 Завантажено ${allData.length} записів`);
    return allData.length > 0 ? allData : getMockData();
  } catch (error) {
    console.error('❌ Помилка Google Sheets:', error);
    return getMockData();
  }
}

function getMockData(): CityData[] {
  return [
    { date: '01.01.2026', cityName: 'Cannes 🇫🇷, 4 Rue Du Vingt-Quatre Août', revenue: 1056.35, checks: 85, avgCheckValue: 12.43, delivery: 110.90, dayOfWeek: 3 },
    { date: '02.01.2026', cityName: 'Cannes 🇫🇷, 4 Rue Du Vingt-Quatre Août', revenue: 1200, checks: 95, avgCheckValue: 12.63, delivery: 120, dayOfWeek: 4 },
    { date: '03.01.2026', cityName: 'Seoul 🇰🇷, Gangdong I-Park The River', revenue: 1500, checks: 100, avgCheckValue: 15, delivery: 0, dayOfWeek: 5 }
  ];
}

function getPreviousDay(dateStr: string): string {
  const parts = dateStr.split('.');
  const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  date.setDate(date.getDate() - 1);
  
  return `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
}

function isDayPassed(dateStr: string): boolean {
  const parts = dateStr.split('.');
  const selectedDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  const today = new Date();
  
  selectedDate.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  return selectedDate < today;
}

async function getDataForDateAndCity(selectedDate: string, cityName: string): Promise<CityData | null> {
  const allData = await getGoogleSheetsData();
  
  return allData.find(d => {
    const dateMatch = d.date.includes(selectedDate) || selectedDate.includes(d.date);
    const cityMatch = d.cityName.toLowerCase().includes(cityName.toLowerCase());
    return dateMatch && cityMatch;
  }) || null;
}

async function getPreviousDayData(selectedDate: string, cityName: string): Promise<CityData | null> {
  const previousDate = getPreviousDay(selectedDate);
  return await getDataForDateAndCity(previousDate, cityName);
}

// АНАЛІЗ ТРЕНДУ ПО ДНЯХ ТИЖНЯ
async function analyzeWeekdayTrend(cityName: string, allData: CityData[]): Promise<Map<number, number>> {
  const weekdayMap = new Map<number, number[]>();
  
  allData
    .filter(d => d.cityName.toLowerCase().includes(cityName.toLowerCase()) && d.revenue > 0)
    .forEach(d => {
      if (!weekdayMap.has(d.dayOfWeek!)) {
        weekdayMap.set(d.dayOfWeek!, []);
      }
      weekdayMap.get(d.dayOfWeek!)!.push(d.revenue);
    });

  // Розраховуємо середній виторг по днях тижня
  const weekdayAverage = new Map<number, number>();
  weekdayMap.forEach((revenues, day) => {
    const avg = revenues.reduce((a, b) => a + b, 0) / revenues.length;
    weekdayAverage.set(day, avg);
  });

  return weekdayAverage;
}

// ЛОКАЛЬНІ СВЯТИ ПО МІСТАМ
function getLocalHolidayMultiplier(cityName: string, month: number, day: number): number {
  const isFrance = cityName.toLowerCase().includes('cannes') || cityName.toLowerCase().includes('nice');
  const isNorway = cityName.toLowerCase().includes('oslo');
  const isKorea = cityName.toLowerCase().includes('seoul');

  const holidays: Record<string, number> = {
    // ГЛОБАЛЬНІ
    '0-1': 0.6,    // Новий рік
    '12-25': 1.3,  // Різдво
    '12-31': 1.4,  // Канун Нового року

    // ФРАНЦІЯ
    'FRANCE_0-1': 0.6,    // Новий рік
    'FRANCE_1-14': 1.15,  // День св. Валентина
    'FRANCE_4-1': 0.8,    // День праці
    'FRANCE_5-1': 0.8,    // День праці
    'FRANCE_7-14': 1.2,   // День взяття Бастилії
    'FRANCE_11-1': 1.1,   // День всіх святих
    'FRANCE_12-25': 1.3,  // Різдво

    // НОРВЕГІЯ
    'NORWAY_0-1': 0.6,    // Новий рік
    'NORWAY_3-17': 1.25,  // День незалежності Норвегії
    'NORWAY_5-1': 0.8,    // День праці
    'NORWAY_5-17': 1.3,   // День Конституції
    'NORWAY_12-25': 1.3,  // Різдво

    // ПІВДЕННА КОРЕЯ
    'KOREA_1-1': 0.5,     // Новий рік (закрито)
    'KOREA_2-10': 1.2,    // Лунний Новий рік (Сольналь)
    'KOREA_3-1': 1.15,    // День незалежності
    'KOREA_5-5': 1.2,     // День дітей
    'KOREA_6-6': 1.1,     // День розпачу
    'KOREA_8-15': 1.25,   // День визволення
    'KOREA_9-16': 0.5,    // Чусок (закрито)
    'KOREA_9-17': 0.5,    // Чусок (закрито)
    'KOREA_10-3': 1.15,   // День національної спадщини
    'KOREA_10-9': 1.1,    // День Ханґуля
    'KOREA_12-25': 1.2    // Різдво
  };

  // Визначаємо країну
  let countryPrefix = '';
  if (isFrance) countryPrefix = 'FRANCE_';
  else if (isNorway) countryPrefix = 'NORWAY_';
  else if (isKorea) countryPrefix = 'KOREA_';

  const key = `${countryPrefix}${month}-${day}`;
  const globalKey = `${month}-${day}`;

  return holidays[key] || holidays[globalKey] || 1.0;
}

// РОЗРАХУНОК ЦІЛЬОВОГО ВИТОРГУ
async function calculateTargetRevenue(selectedDate: string, cityName: string): Promise<{
  targetRevenue: number | null;
  actualRevenue: number | null;
  previousRevenue: number;
  isDayPassed: boolean;
  message: string;
}> {
  console.log(`\n🎯 РОЗРАХУНОК для ${selectedDate} | ${cityName}`);

  const allData = await getGoogleSheetsData();
  const isPassed = isDayPassed(selectedDate);

  // ПОПЕРЕДНІЙ ДЕНЬ
  const prevData = await getPreviousDayData(selectedDate, cityName);
  const previousRevenue = prevData ? prevData.revenue : 0;
  console.log(`📊 Попередній день: ${previousRevenue}€`);

  if (isPassed) {
    const actualData = await getDataForDateAndCity(selectedDate, cityName);
    const actualRevenue = actualData ? actualData.revenue : 0;
    console.log(`✅ День пройшов. Реальний виторг: ${actualRevenue}€`);

    return {
      targetRevenue: null,
      actualRevenue: actualRevenue,
      previousRevenue: previousRevenue,
      isDayPassed: true,
      message: actualRevenue > 0 ? `РЕАЛЬНИЙ ВИТОРГ: ${actualRevenue}€` : 'Дані для цього дня відсутні'
    };
  }

  // РОЗРАХУНОК ЦІЛІ
  const cityData = allData.filter(d => d.cityName.toLowerCase().includes(cityName.toLowerCase()) && d.revenue > 0);
  
  if (cityData.length === 0) {
    console.log('⚠️ Немає даних');
    return {
      targetRevenue: 1200,
      actualRevenue: null,
      previousRevenue: previousRevenue,
      isDayPassed: false,
      message: 'Недостатньо даних'
    };
  }

  // ОТРИМУЄМО ДАТУ
  const dateParts = selectedDate.split('.');
  const dateObj = new Date(parseInt(dateParts[2]), parseInt(dateParts[1]) - 1, parseInt(dateParts[0]));
  const dayOfWeek = dateObj.getDay();
  const month = dateObj.getMonth();
  const day = dateObj.getDate();

  // АНАЛІЗ ТРЕНДУ ПО ДНЯХ ТИЖНЯ
  const weekdayTrend = await analyzeWeekdayTrend(cityName, allData);
  const weekdayAvg = weekdayTrend.get(dayOfWeek) || 1000;
  
  console.log(`📅 Середній виторг для ${['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'][dayOfWeek]}: ${weekdayAvg.toFixed(2)}€`);

  // ЗАГАЛЬНИЙ СЕРЕДНІЙ
  const allRevenues = cityData.map(d => d.revenue);
  const overallAvg = allRevenues.reduce((a, b) => a + b, 0) / allRevenues.length;
  console.log(`💰 Загальний середній: ${overallAvg.toFixed(2)}€`);

  // ЛОКАЛЬНІ СВЯТИ
  const holidayMult = getLocalHolidayMultiplier(cityName, month, day);
  console.log(`🎄 Святи множник: ${holidayMult}`);

  // СЕЗОННІСТЬ
  const seasonMult = [0.85, 0.9, 1.0, 1.05, 1.1, 1.15, 1.2, 1.2, 1.1, 1.05, 1.15, 1.3][month];
  console.log(`🌡️ Сезонність: ${seasonMult}`);

  // ЛОКАЦІЯ (впливає на базовий рівень)
  let locationMult = 1.0;
  if (cityName.toLowerCase().includes('cannes')) locationMult = 1.15;
  else if (cityName.toLowerCase().includes('nice')) locationMult = 1.05;
  else if (cityName.toLowerCase().includes('seoul')) locationMult = 1.25;
  else if (cityName.toLowerCase().includes('oslo')) locationMult = 1.1;
  console.log(`📍 Локація: ${locationMult}`);

  // ФОРМУЛА РОЗРАХУНКУ
  // Базуємось на тренді дня тижня + святи + сезонність + локація
  const baseTarget = weekdayAvg * locationMult;
  const calculatedTarget = baseTarget * holidayMult * seasonMult;

  console.log(`✅ ЦІЛЬОВИЙ ВИТОРГ: ${Math.round(calculatedTarget)}€\n`);

  return {
    targetRevenue: Math.round(calculatedTarget),
    actualRevenue: null,
    previousRevenue: Math.round(previousRevenue),
    isDayPassed: false,
    message: `ЦІЛЬОВИЙ ВИТОРГ: ${Math.round(calculatedTarget)}€`
  };
}

// ===== API ROUTES =====

app.get('/health', (req, res) => {
  res.json({ status: '✅ Ready' });
});

app.get('/api/cities', async (req, res) => {
  try {
    const allData = await getGoogleSheetsData();
    const citiesSet = new Set<string>();

    for (const data of allData) {
      if (data.revenue > 0) {
        citiesSet.add(data.cityName);
      }
    }

    const cities = Array.from(citiesSet);
    console.log('🏙️ Доступні міста:', cities);

    res.json(cities.length > 0 ? cities : [
      'Cannes 🇫🇷, 4 Rue Du Vingt-Quatre Août',
      'Nice 🇫🇷, 31 Av. Malaussena',
      'Seoul 🇰🇷, Gangdong I-Park The River',
      'Oslo 🇳🇴, Arbeidersamfunnets Plass 1'
    ]);
  } catch (error) {
    console.error('Помилка:', error);
    res.json([]);
  }
});

app.post('/api/voice', async (req, res) => {
  try {
    const { transcript, userId, location, date } = req.body;

    console.log('📦 Запит:', transcript);
    console.log('📍 Локація:', location);
    console.log('📅 Дата:', date);

    const result = await calculateTargetRevenue(date, location);

    const response = result.isDayPassed 
      ? (result.actualRevenue || 0) + '€'
      : (result.targetRevenue || 0) + '€';

    res.json({
      transcript: transcript,
      response: response,
      analytics: {
        targetRevenue: result.targetRevenue,
        actualRevenue: result.actualRevenue,
        previousRevenue: result.previousRevenue,
        isDayPassed: result.isDayPassed,
        message: result.message,
        location: location,
        date: date
      },
      processingTime: 100
    });
  } catch (error) {
    console.error('❌ Помилка:', error);
    res.status(500).json({
      error: 'Помилка',
      response: '0€'
    });
  }
});

app.get('/api/menu', (req, res) => {
  res.json([
    { name: 'Круасан з куркою', price: 45, emoji: '🍗' },
    { name: 'Круасан з шоколадом', price: 35, emoji: '🍫' },
    { name: 'Круасан зі сливками', price: 40, emoji: '🍓' }
  ]);
});

io.on('connection', (socket: Socket) => {
  console.log('🔌 Connected:', socket.id);
  socket.on('disconnect', () => console.log('❌ Disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 http://localhost:${PORT}`);
  console.log(`📊 Smart Revenue Calculator with Local Holidays\n`);
});