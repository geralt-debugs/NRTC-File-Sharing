import { advertiseFiles } from "./client";

const folderInput = document.getElementById("folderUpload") as HTMLInputElement;
const fileList = document.getElementById("fileList") as HTMLUListElement;

folderInput?.addEventListener("change", (event: Event) => {
  const files = (event.target as HTMLInputElement).files;
  fileList.innerHTML = ""; // Clear previous list

  if (!files) return;

  const fileArray = Array.from(files);

  // Sort by full path
  fileArray.sort((a, b) =>
    a.webkitRelativePath.localeCompare(b.webkitRelativePath)
  );

  for (const file of fileArray) {
    const li = document.createElement("li");
    const depth = file.webkitRelativePath.split("/").length - 1;

    li.style.paddingLeft = `${depth * 20}px`;
    li.textContent = file.webkitRelativePath;
    fileList.appendChild(li);
  }

  // Advertise files to the network
  advertiseFiles(
    fileArray.map((file) => ({
      name: file.name,
      metadata: JSON.stringify({ size: file.size, mime: file.type, file }),
    }))
  );
});
