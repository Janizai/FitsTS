import { Fits, FitsHDU, FitsHeader } from 'fits-ts';

(async () => {
  // Reading a FITS file
  const fits = await Fits.open('example.fits');
  console.log(`HDU count: ${fits.hdus.length}`);
  const primaryHDU = fits.primary;
  console.log(`Image dimensions: ${primaryHDU.width} x ${primaryHDU.height}`);
  console.log(`BITPIX: ${primaryHDU.header.BITPIX}, Data type: ${primaryHDU.header.get('BITPIX')}`);
  // Access a pixel value (e.g., first pixel)
  if (primaryHDU.data) {
    console.log(`First pixel value: ${primaryHDU.data[0]}`);
  }
  // Modify a header value
  primaryHDU.header.OBJECT = "New Object Name";
  primaryHDU.header.addHistory("Updated OBJECT name");
  // Modify pixel data (for example, set first pixel to 0)
  if (primaryHDU.data) {
    primaryHDU.data[0] = 0;
  }
  // Save modifications to a new file
  await fits.save('example_modified.fits');

  // Creating a new FITS file from scratch (100x100 image, 16-bit signed integers)
  const newFits = Fits.create([100, 100], 'int16');
  const newImage = newFits.primary;
  newImage.header.set('OBJECT', 'Synthetic Data');
  // Fill the image with a gradient
  if (newImage.data) {
    for (let i = 0; i < newImage.data.length; i++) {
      newImage.data[i] = i % 256;  // example pattern
    }
  }
  await newFits.save('new_image.fits');
})();
