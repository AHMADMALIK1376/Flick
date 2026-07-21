import { Page } from 'playwright';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { LLMService } from './llm/llm-service';
import { BrowserTaskNotifier, ToastMessage } from '../../shared/types';

/** Extracted course/assignment details from an LMS page. */
export interface CourseDetails {
  courseName: string;
  courseCode?: string;
  instructor?: string;
  assignments: AssignmentDetails[];
}

export interface AssignmentDetails {
  title: string;
  description: string;
  dueDate?: string;
  points?: number;
  requirements?: string[];
  rubric?: string;
}

export interface AcademicAnswer {
  title: string;
  content: string;
  wordCount: number;
  references?: string[];
}

/** Common LMS URL patterns for login detection. */
const LMS_PATTERNS = [
  'blackboard.com',
  'canvas.instructure.com',
  'moodle',
  'brightspace',
  'd2l.com',
  'lms.',
  'elearning.',
  'iqra.edu',
  'portal.',
];

const ACADEMIC_SYSTEM_PROMPT = `You are an academic writing assistant. Generate well-structured, scholarly answers for university assignments. Follow these guidelines:
- Use formal academic tone with clear thesis statements
- Include topic sentences for each paragraph
- Support arguments with logical reasoning
- Use transitional phrases between ideas
- Conclude with a summary that reinforces the main argument
- Avoid plagiarism - generate original analysis and synthesis
- Format with clear introduction, body paragraphs, and conclusion
Respond with JSON: {"title":"<assignment title>","content":"<full answer text>","wordCount":<count>,"references":["<ref1>","<ref2>"]}`;

const EXTRACTION_PROMPT = `Extract course and assignment details from this page content. Return JSON:
{"courseName":"<name>","courseCode":"<code>","instructor":"<name>","assignments":[{"title":"<title>","description":"<desc>","dueDate":"<date>","points":<pts>,"requirements":["<req1>"],"rubric":"<rubric text>"}]}
Only include assignments visible on the page. If no assignments found, return empty array.`;

/**
 * Academic Assistant module for the browser agent.
 * Navigates to university LMS, waits for login, extracts course/assignment details,
 * generates academic answers using GPT, and creates PDF files.
 */
export class AcademicAssistant {
  private llm: LLMService;
  private notifier: BrowserTaskNotifier;
  private outputDir: string;

  constructor(llm: LLMService, notifier: BrowserTaskNotifier) {
    this.llm = llm;
    this.notifier = notifier;
    this.outputDir = path.join(app.getPath('documents'), 'EduPilot', 'Assignments');
  }

  /**
   * Full workflow: Navigate to LMS, wait for login, extract assignments,
   * generate answers, and create PDFs.
   */
  async runAcademicWorkflow(
    page: Page,
    lmsUrl: string,
    signal: AbortSignal
  ): Promise<{ success: boolean; pdfsCreated: string[]; error?: string }> {
    const pdfsCreated: string[] = [];

    try {
      // Step 1: Navigate to LMS
      await page.goto(lmsUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Step 2: Wait for user to log in (detect login page, notify, wait)
      const loginWaitResult = await this.waitForLogin(page, signal);
      if (!loginWaitResult.success) {
        return { success: false, pdfsCreated, error: loginWaitResult.error };
      }

      // Step 3: Extract course and assignment details
      const courses = await this.extractCourseDetails(page);
      if (courses.assignments.length === 0) {
        this.sendToast('warning', 'No assignments found on the current page.');
        return { success: true, pdfsCreated, error: 'No assignments found' };
      }

      this.sendToast('success', `Found ${courses.assignments.length} assignment(s). Generating answers...`);

      // Step 4: Generate answers for each assignment
      for (const assignment of courses.assignments) {
        if (signal.aborted) {
          return { success: false, pdfsCreated, error: 'Cancelled by user' };
        }

        // Check budget before each generation
        if (this.llm.budgetTracker.isOverBudget()) {
          return {
            success: false,
            pdfsCreated,
            error: `Budget exceeded after generating ${pdfsCreated.length} answer(s).`,
          };
        }

        const answer = await this.generateAcademicAnswer(assignment, courses.courseName);
        if (answer) {
          // Step 5: Create PDF
          const pdfPath = await this.createPdf(answer, courses.courseName, assignment.title);
          pdfsCreated.push(pdfPath);
        }
      }

      this.sendToast('success', `Created ${pdfsCreated.length} PDF(s) in Documents/EduPilot/Assignments`);
      return { success: true, pdfsCreated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, pdfsCreated, error: message };
    }
  }

  /**
   * Wait for the user to complete login on the LMS page.
   * Detects login pages and waits up to 5 minutes for navigation away.
   */
  private async waitForLogin(
    page: Page,
    signal: AbortSignal
  ): Promise<{ success: boolean; error?: string }> {
    const isLoginPage = this.detectLoginPage(page.url());

    if (!isLoginPage) {
      // Already logged in or not on a login page
      return { success: true };
    }

    // Notify user that login is required
    this.notifier.sendLoginRequired('academic-task', page.url());
    this.sendToast('warning', 'Please log in to your LMS. Waiting for authentication...');

    // Wait up to 5 minutes for the user to log in
    const maxWaitMs = 5 * 60 * 1000;
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      if (signal.aborted) {
        return { success: false, error: 'Cancelled while waiting for login' };
      }

      await this.delay(pollIntervalMs);

      // Check if we've navigated away from login page
      if (!this.detectLoginPage(page.url())) {
        this.sendToast('success', 'Login detected. Proceeding with extraction...');
        // Wait for page to fully load after login redirect
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        return { success: true };
      }
    }

    return { success: false, error: 'Login timeout (5 minutes). Please try again.' };
  }

  /**
   * Extract course and assignment details from the current page.
   */
  async extractCourseDetails(page: Page): Promise<CourseDetails> {
    // Read page content
    const content = await page.evaluate(() => document.body.innerText);
    const truncatedContent = content.slice(0, 4000); // Limit context size

    const result = await this.llm.textComplete(
      EXTRACTION_PROMPT,
      `Page content:\n${truncatedContent}`,
      true
    );

    if (!result.ok) {
      throw new Error(`Failed to extract course details: ${result.error.message}`);
    }

    try {
      const parsed = JSON.parse(result.text) as CourseDetails;
      return {
        courseName: parsed.courseName || 'Unknown Course',
        courseCode: parsed.courseCode,
        instructor: parsed.instructor,
        assignments: parsed.assignments || [],
      };
    } catch {
      throw new Error('Failed to parse extracted course details');
    }
  }

  /**
   * Generate an academic answer for a given assignment using GPT.
   */
  async generateAcademicAnswer(
    assignment: AssignmentDetails,
    courseName: string
  ): Promise<AcademicAnswer | null> {
    const userMessage = `Course: ${courseName}
Assignment: ${assignment.title}
Description: ${assignment.description}
${assignment.requirements ? `Requirements: ${assignment.requirements.join(', ')}` : ''}
${assignment.rubric ? `Rubric: ${assignment.rubric}` : ''}
${assignment.points ? `Points: ${assignment.points}` : ''}

Generate a comprehensive academic answer for this assignment. Use formal academic writing style with proper structure.`;

    // Use higher token limit for academic content generation
    const result = await this.llm.textComplete(
      ACADEMIC_SYSTEM_PROMPT,
      userMessage,
      true,
      2000 // Higher limit for full academic answers
    );

    if (!result.ok) {
      console.error(`Failed to generate answer for "${assignment.title}": ${result.error.message}`);
      return null;
    }

    try {
      const parsed = JSON.parse(result.text) as AcademicAnswer;
      return {
        title: parsed.title || assignment.title,
        content: parsed.content || '',
        wordCount: parsed.wordCount || parsed.content?.split(/\s+/).length || 0,
        references: parsed.references,
      };
    } catch {
      // If JSON parsing fails, treat the whole response as content
      return {
        title: assignment.title,
        content: result.text,
        wordCount: result.text.split(/\s+/).length,
      };
    }
  }

  /**
   * Create a PDF file from an academic answer using pdfkit.
   */
  async createPdf(answer: AcademicAnswer, courseName: string, assignmentTitle: string): Promise<string> {
    // Ensure output directory exists
    fs.mkdirSync(this.outputDir, { recursive: true });

    // Sanitize filename
    const sanitizedTitle = assignmentTitle
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${sanitizedTitle}_${timestamp}.pdf`;
    const filePath = path.join(this.outputDir, filename);

    return new Promise<string>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 72, bottom: 72, left: 72, right: 72 },
      });

      const writeStream = fs.createWriteStream(filePath);
      doc.pipe(writeStream);

      // Header
      doc.fontSize(10).fillColor('#666666');
      doc.text(`Course: ${courseName}`, { align: 'left' });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'left' });
      doc.moveDown(1);

      // Title
      doc.fontSize(16).fillColor('#000000');
      doc.text(answer.title, { align: 'center' });
      doc.moveDown(1.5);

      // Divider line
      doc.moveTo(72, doc.y).lineTo(523, doc.y).stroke('#cccccc');
      doc.moveDown(1);

      // Body content
      doc.fontSize(12).fillColor('#333333');
      const paragraphs = answer.content.split('\n\n');
      for (const paragraph of paragraphs) {
        if (paragraph.trim()) {
          doc.text(paragraph.trim(), {
            align: 'justify',
            lineGap: 4,
            indent: 36,
          });
          doc.moveDown(0.8);
        }
      }

      // References section
      if (answer.references && answer.references.length > 0) {
        doc.moveDown(1);
        doc.moveTo(72, doc.y).lineTo(523, doc.y).stroke('#cccccc');
        doc.moveDown(0.5);
        doc.fontSize(13).fillColor('#000000');
        doc.text('References', { align: 'left' });
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#333333');
        for (const ref of answer.references) {
          doc.text(`• ${ref}`, { indent: 18 });
          doc.moveDown(0.3);
        }
      }

      // Footer with word count
      doc.moveDown(2);
      doc.fontSize(9).fillColor('#999999');
      doc.text(`Word Count: ${answer.wordCount}`, { align: 'right' });

      doc.end();

      writeStream.on('finish', () => resolve(filePath));
      writeStream.on('error', reject);
    });
  }

  /**
   * Detect if a URL is a login/authentication page.
   */
  private detectLoginPage(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    const loginPatterns = [
      '/login', '/signin', '/sign-in', '/auth', '/sso',
      '/oauth', '/authenticate', '/account/login', '/cas/login',
    ];
    return loginPatterns.some((pattern) => lowerUrl.includes(pattern));
  }

  /**
   * Check if a URL is an LMS platform.
   */
  static isLmsUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return LMS_PATTERNS.some((pattern) => lowerUrl.includes(pattern));
  }

  private sendToast(type: 'success' | 'warning' | 'error', message: string): void {
    const toast: ToastMessage = { type, message, autoDismissMs: 5000 };
    this.notifier.sendToast(toast);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
