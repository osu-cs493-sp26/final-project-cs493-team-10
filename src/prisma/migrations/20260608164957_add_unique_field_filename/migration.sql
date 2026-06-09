/*
  Warnings:

  - A unique constraint covering the columns `[file_name]` on the table `Submission` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Submission_file_name_key" ON "Submission"("file_name");
