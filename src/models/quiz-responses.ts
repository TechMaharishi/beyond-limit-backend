import mongoose, { Schema, Document, Types } from "mongoose";

export interface IQuizAnswer {
  questionIndex: number;
  selectedOptionIndexes: number[];
  isCorrect?: boolean;
}

export interface IQuizResponse extends Document {
  userId: Types.ObjectId;
  courseId: Types.ObjectId;
  chapterId: Types.ObjectId;
  quizIndex: number;
  answers: IQuizAnswer[];
  createdAt: Date;
  updatedAt: Date;
}

// Define as a plain Schema to avoid TypeScript union complexity
const QuizAnswerSchema = new Schema(
  {
    questionIndex: { type: Schema.Types.Number, required: true, min: 0 },
    selectedOptionIndexes: { type: [Schema.Types.Number], required: true, default: [] },
    isCorrect: { type: Boolean },
  },
  { _id: false }
);

const QuizResponseSchema: Schema<IQuizResponse> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    chapterId: { type: Schema.Types.ObjectId, required: true },
    quizIndex: { type: Number, required: true, default: 0, min: 0 },
    answers: { type: [QuizAnswerSchema], required: true, default: [] },
  },
  { timestamps: true }
);

QuizResponseSchema.index({ userId: 1, courseId: 1, chapterId: 1, createdAt: -1 });

export const QuizResponse = mongoose.model<IQuizResponse>(
  "QuizResponse",
  QuizResponseSchema,
  "quiz-responses"
);